/**
 * Live Collaboration Primitives for ReactiveBase.
 * Drop-in collaboration kit: cursors, selection awareness, typing indicators,
 * and avatar stacks — built on the existing presence and CRDT modules.
 *
 * Usage:
 *   const collab = new CollaborationManager({ ttl: 30000 })
 *   collab.updateCursor("room-1", "conn-1", { x: 100, y: 200, userId: "alice" })
 *   collab.updateSelection("room-1", "conn-1", { start: 0, end: 10, field: "title" })
 *   collab.setTyping("room-1", "conn-1", true)
 *   collab.onAwarenessChange("room-1", (state) => broadcastToClients(state))
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CursorPosition {
  x: number
  y: number
  /** Target element or field identifier */
  target?: string
}

export interface SelectionRange {
  /** Field or element ID the selection is in */
  field: string
  /** Start offset */
  start: number
  /** End offset */
  end: number
  /** Direction of selection */
  direction?: "forward" | "backward"
}

export interface UserAwareness {
  connectionId: string
  userId: string
  userName: string
  userColor: string
  cursor: CursorPosition | null
  selection: SelectionRange | null
  isTyping: boolean
  isOnline: boolean
  lastActivity: number
  metadata: Record<string, unknown>
}

export interface RoomAwarenessState {
  roomId: string
  users: UserAwareness[]
  activeCount: number
  updatedAt: number
}

export interface CollaborationOptions {
  /** TTL for presence entries in ms (default: 30000) */
  ttl?: number
  /** Typing indicator auto-expire in ms (default: 5000) */
  typingTimeoutMs?: number
  /** Max users per room (default: 100) */
  maxUsersPerRoom?: number
  /** Debounce cursor updates in ms (default: 50) */
  cursorDebounceMs?: number
  /** Colors to assign to users (cycles through) */
  userColors?: string[]
}

export type AwarenessListener = (roomId: string, state: RoomAwarenessState) => void

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_COLORS = [
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#06B6D4",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F43F5E",
  "#14B8A6",
]

const DEFAULT_OPTIONS: Required<CollaborationOptions> = {
  ttl: 30_000,
  typingTimeoutMs: 5_000,
  maxUsersPerRoom: 100,
  cursorDebounceMs: 50,
  userColors: DEFAULT_COLORS,
}

// ─── CollaborationManager ────────────────────────────────────────────────────

/**
 * Manages real-time collaboration state including cursor positions,
 * selection ranges, typing indicators, and user presence.
 */
export class CollaborationManager {
  private rooms = new Map<string, Map<string, UserAwareness>>()
  private listeners = new Map<string, Set<AwarenessListener>>()
  private globalListeners = new Set<AwarenessListener>()
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private colorIndex = 0
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private options: Required<CollaborationOptions>

  constructor(options: CollaborationOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  // ─── User Management ──────────────────────────────────────────────────

  /**
   * Join a collaboration room. Returns the assigned user color.
   */
  join(
    roomId: string,
    connectionId: string,
    user: { userId: string; userName: string; metadata?: Record<string, unknown> },
  ): UserAwareness {
    let room = this.rooms.get(roomId)
    if (!room) {
      room = new Map()
      this.rooms.set(roomId, room)
    }

    if (room.size >= this.options.maxUsersPerRoom && !room.has(connectionId)) {
      throw new Error(`Room ${roomId} has reached the maximum of ${this.options.maxUsersPerRoom} users`)
    }

    const existing = room.get(connectionId)
    if (existing) return existing

    const awareness: UserAwareness = {
      connectionId,
      userId: user.userId,
      userName: user.userName,
      userColor: this.assignColor(),
      cursor: null,
      selection: null,
      isTyping: false,
      isOnline: true,
      lastActivity: Date.now(),
      metadata: user.metadata ?? {},
    }

    room.set(connectionId, awareness)
    this.notifyListeners(roomId)
    return awareness
  }

  /**
   * Leave a collaboration room.
   */
  leave(roomId: string, connectionId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    room.delete(connectionId)
    this.clearTypingTimer(`${roomId}:${connectionId}`)

    if (room.size === 0) {
      this.rooms.delete(roomId)
    }

    this.notifyListeners(roomId)
  }

  /**
   * Disconnect a user from all rooms.
   */
  disconnect(connectionId: string): string[] {
    const leftRooms: string[] = []
    for (const [roomId, room] of this.rooms) {
      if (room.has(connectionId)) {
        this.leave(roomId, connectionId)
        leftRooms.push(roomId)
      }
    }
    return leftRooms
  }

  // ─── Cursor ────────────────────────────────────────────────────────────

  /**
   * Update cursor position for a user in a room.
   */
  updateCursor(roomId: string, connectionId: string, cursor: CursorPosition): void {
    const awareness = this.getAwareness(roomId, connectionId)
    if (!awareness) return

    awareness.cursor = cursor
    awareness.lastActivity = Date.now()
    this.notifyListeners(roomId)
  }

  /**
   * Clear cursor for a user.
   */
  clearCursor(roomId: string, connectionId: string): void {
    const awareness = this.getAwareness(roomId, connectionId)
    if (!awareness) return

    awareness.cursor = null
    this.notifyListeners(roomId)
  }

  // ─── Selection ─────────────────────────────────────────────────────────

  /**
   * Update text/element selection for a user.
   */
  updateSelection(roomId: string, connectionId: string, selection: SelectionRange): void {
    const awareness = this.getAwareness(roomId, connectionId)
    if (!awareness) return

    awareness.selection = selection
    awareness.lastActivity = Date.now()
    this.notifyListeners(roomId)
  }

  /**
   * Clear selection for a user.
   */
  clearSelection(roomId: string, connectionId: string): void {
    const awareness = this.getAwareness(roomId, connectionId)
    if (!awareness) return

    awareness.selection = null
    this.notifyListeners(roomId)
  }

  // ─── Typing ────────────────────────────────────────────────────────────

  /**
   * Set typing indicator. Automatically expires after typingTimeoutMs.
   */
  setTyping(roomId: string, connectionId: string, isTyping: boolean): void {
    const awareness = this.getAwareness(roomId, connectionId)
    if (!awareness) return

    const timerKey = `${roomId}:${connectionId}`
    this.clearTypingTimer(timerKey)

    awareness.isTyping = isTyping
    awareness.lastActivity = Date.now()

    if (isTyping) {
      const timer = setTimeout(() => {
        awareness.isTyping = false
        this.typingTimers.delete(timerKey)
        this.notifyListeners(roomId)
      }, this.options.typingTimeoutMs)
      this.typingTimers.set(timerKey, timer)
    }

    this.notifyListeners(roomId)
  }

  // ─── State Queries ─────────────────────────────────────────────────────

  /**
   * Get the full awareness state for a room.
   */
  getRoomState(roomId: string): RoomAwarenessState {
    const room = this.rooms.get(roomId)
    const users = room ? [...room.values()] : []

    return {
      roomId,
      users,
      activeCount: users.filter((u) => u.isOnline).length,
      updatedAt: Date.now(),
    }
  }

  /**
   * Get awareness for a specific user in a room.
   */
  getUserAwareness(roomId: string, connectionId: string): UserAwareness | undefined {
    return this.getAwareness(roomId, connectionId)
  }

  /**
   * Get all active cursors in a room.
   */
  getCursors(
    roomId: string,
  ): Array<{ connectionId: string; userId: string; userName: string; color: string; cursor: CursorPosition }> {
    const room = this.rooms.get(roomId)
    if (!room) return []

    return [...room.values()]
      .filter((u) => u.cursor !== null && u.isOnline)
      .map((u) => ({
        connectionId: u.connectionId,
        userId: u.userId,
        userName: u.userName,
        color: u.userColor,
        cursor: u.cursor!,
      }))
  }

  /**
   * Get all active selections in a room.
   */
  getSelections(
    roomId: string,
  ): Array<{ connectionId: string; userId: string; color: string; selection: SelectionRange }> {
    const room = this.rooms.get(roomId)
    if (!room) return []

    return [...room.values()]
      .filter((u) => u.selection !== null && u.isOnline)
      .map((u) => ({
        connectionId: u.connectionId,
        userId: u.userId,
        color: u.userColor,
        selection: u.selection!,
      }))
  }

  /**
   * Get all typing users in a room.
   */
  getTypingUsers(roomId: string): Array<{ connectionId: string; userId: string; userName: string }> {
    const room = this.rooms.get(roomId)
    if (!room) return []

    return [...room.values()]
      .filter((u) => u.isTyping && u.isOnline)
      .map((u) => ({
        connectionId: u.connectionId,
        userId: u.userId,
        userName: u.userName,
      }))
  }

  /**
   * Get the list of active rooms.
   */
  getActiveRooms(): Array<{ roomId: string; userCount: number }> {
    return [...this.rooms.entries()].map(([roomId, room]) => ({
      roomId,
      userCount: room.size,
    }))
  }

  // ─── Listeners ─────────────────────────────────────────────────────────

  /**
   * Listen for awareness changes in a specific room.
   */
  onAwarenessChange(roomId: string, listener: AwarenessListener): () => void {
    let listeners = this.listeners.get(roomId)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(roomId, listeners)
    }
    listeners.add(listener)

    return () => {
      listeners!.delete(listener)
      if (listeners!.size === 0) this.listeners.delete(roomId)
    }
  }

  /**
   * Listen for awareness changes in all rooms.
   */
  onAnyChange(listener: AwarenessListener): () => void {
    this.globalListeners.add(listener)
    return () => this.globalListeners.delete(listener)
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  /**
   * Start periodic cleanup of expired entries.
   */
  startCleanup(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => this.cleanup(), this.options.ttl / 2)
  }

  /**
   * Stop periodic cleanup.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Remove expired entries and clear all state.
   */
  destroy(): void {
    this.stopCleanup()
    for (const timer of this.typingTimers.values()) {
      clearTimeout(timer)
    }
    this.typingTimers.clear()
    this.rooms.clear()
    this.listeners.clear()
    this.globalListeners.clear()
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [roomId, room] of this.rooms) {
      let changed = false
      for (const [connId, awareness] of room) {
        if (now - awareness.lastActivity > this.options.ttl) {
          room.delete(connId)
          this.clearTypingTimer(`${roomId}:${connId}`)
          changed = true
        }
      }
      if (room.size === 0) {
        this.rooms.delete(roomId)
      }
      if (changed) {
        this.notifyListeners(roomId)
      }
    }
  }

  private getAwareness(roomId: string, connectionId: string): UserAwareness | undefined {
    return this.rooms.get(roomId)?.get(connectionId)
  }

  private assignColor(): string {
    const color = this.options.userColors[this.colorIndex % this.options.userColors.length]
    this.colorIndex++
    return color
  }

  private clearTypingTimer(key: string): void {
    const timer = this.typingTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.typingTimers.delete(key)
    }
  }

  private notifyListeners(roomId: string): void {
    const state = this.getRoomState(roomId)
    const roomListeners = this.listeners.get(roomId)
    if (roomListeners) {
      for (const listener of roomListeners) {
        listener(roomId, state)
      }
    }
    for (const listener of this.globalListeners) {
      listener(roomId, state)
    }
  }
}
