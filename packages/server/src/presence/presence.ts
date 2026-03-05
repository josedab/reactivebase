/**
 * Presence system for live collaboration.
 * Tracks per-connection state (cursor position, active user, typing status, etc.)
 * and broadcasts changes to other connections in the same room.
 */

export interface PresenceData {
  connectionId: string
  userId?: string
  data: Record<string, unknown>
  updatedAt: number
}

export interface PresenceOptions {
  /** Time in ms before a presence entry expires (default: 30000) */
  ttl?: number
  /** Max presence entries per room (default: 1000) */
  maxPerRoom?: number
}

const DEFAULT_OPTIONS: Required<PresenceOptions> = {
  ttl: 30_000,
  maxPerRoom: 1000,
}

export type PresenceListener = (roomId: string, presenceList: PresenceData[]) => void

/**
 * In-memory presence tracker.
 * Each "room" is an independent scope for tracking presence.
 */
export class PresenceManager {
  private rooms = new Map<string, Map<string, PresenceData>>()
  private connectionRooms = new Map<string, Set<string>>()
  private listeners = new Set<PresenceListener>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private options: Required<PresenceOptions>

  constructor(options: PresenceOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Set presence data for a connection in a room.
   */
  set(roomId: string, connectionId: string, data: Record<string, unknown>, userId?: string): void {
    let room = this.rooms.get(roomId)
    if (!room) {
      room = new Map()
      this.rooms.set(roomId, room)
    }

    if (room.size >= this.options.maxPerRoom && !room.has(connectionId)) {
      return // Room full
    }

    room.set(connectionId, {
      connectionId,
      userId,
      data,
      updatedAt: Date.now(),
    })

    // Track which rooms this connection is in
    if (!this.connectionRooms.has(connectionId)) {
      this.connectionRooms.set(connectionId, new Set())
    }
    this.connectionRooms.get(connectionId)!.add(roomId)

    this.notifyListeners(roomId)
  }

  /**
   * Get all presence data for a room.
   */
  getRoom(roomId: string): PresenceData[] {
    const room = this.rooms.get(roomId)
    if (!room) return []

    const now = Date.now()
    const active: PresenceData[] = []

    for (const [connId, presence] of room) {
      if (now - presence.updatedAt > this.options.ttl) {
        room.delete(connId)
      } else {
        active.push({ ...presence })
      }
    }

    return active
  }

  /**
   * Remove a connection from all rooms.
   */
  removeConnection(connectionId: string): void {
    const rooms = this.connectionRooms.get(connectionId)
    if (!rooms) return

    for (const roomId of rooms) {
      const room = this.rooms.get(roomId)
      if (room) {
        room.delete(connectionId)
        if (room.size === 0) {
          this.rooms.delete(roomId)
        }
        this.notifyListeners(roomId)
      }
    }

    this.connectionRooms.delete(connectionId)
  }

  /**
   * Remove a connection from a specific room.
   */
  leave(roomId: string, connectionId: string): void {
    const room = this.rooms.get(roomId)
    if (room) {
      room.delete(connectionId)
      if (room.size === 0) {
        this.rooms.delete(roomId)
      }
      this.notifyListeners(roomId)
    }

    this.connectionRooms.get(connectionId)?.delete(roomId)
  }

  /**
   * Register a listener for presence changes.
   */
  onUpdate(listener: PresenceListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Start periodic cleanup of expired presence entries.
   */
  startCleanup(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => this.cleanup(), this.options.ttl)
  }

  /**
   * Stop cleanup and clear all data.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.rooms.clear()
    this.connectionRooms.clear()
  }

  get roomCount(): number {
    return this.rooms.size
  }

  get totalPresence(): number {
    let count = 0
    for (const room of this.rooms.values()) count += room.size
    return count
  }

  private notifyListeners(roomId: string): void {
    const presenceList = this.getRoom(roomId)
    for (const listener of this.listeners) {
      listener(roomId, presenceList)
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [roomId, room] of this.rooms) {
      for (const [connId, presence] of room) {
        if (now - presence.updatedAt > this.options.ttl) {
          room.delete(connId)
          this.connectionRooms.get(connId)?.delete(roomId)
        }
      }
      if (room.size === 0) {
        this.rooms.delete(roomId)
      }
    }
  }
}

// --- Conflict-free operations ---

/**
 * Conflict-free counter operations.
 * Generates SQL that atomically increments/decrements a column value.
 */
export function buildIncrementSQL(
  tableName: string,
  id: string,
  column: string,
  delta: number,
): { sql: string; params: unknown[] } {
  const t = tableName.replace(/"/g, '""')
  const c = column.replace(/"/g, '""')
  return {
    sql: `UPDATE "${t}" SET "${c}" = "${c}" + $1 WHERE "id" = $2 RETURNING *`,
    params: [delta, id],
  }
}

/**
 * Build SQL for an atomic array append operation.
 */
export function buildArrayAppendSQL(
  tableName: string,
  id: string,
  column: string,
  value: unknown,
): { sql: string; params: unknown[] } {
  const t = tableName.replace(/"/g, '""')
  const c = column.replace(/"/g, '""')
  return {
    sql: `UPDATE "${t}" SET "${c}" = array_append("${c}", $1) WHERE "id" = $2 RETURNING *`,
    params: [value, id],
  }
}

/**
 * Build SQL for an atomic array remove operation.
 */
export function buildArrayRemoveSQL(
  tableName: string,
  id: string,
  column: string,
  value: unknown,
): { sql: string; params: unknown[] } {
  const t = tableName.replace(/"/g, '""')
  const c = column.replace(/"/g, '""')
  return {
    sql: `UPDATE "${t}" SET "${c}" = array_remove("${c}", $1) WHERE "id" = $2 RETURNING *`,
    params: [value, id],
  }
}

/**
 * Build SQL for a JSONB merge (last-write-wins at the field level).
 */
export function buildJsonMergeSQL(
  tableName: string,
  id: string,
  column: string,
  patch: Record<string, unknown>,
): { sql: string; params: unknown[] } {
  const t = tableName.replace(/"/g, '""')
  const c = column.replace(/"/g, '""')
  return {
    sql: `UPDATE "${t}" SET "${c}" = "${c}" || $1::jsonb WHERE "id" = $2 RETURNING *`,
    params: [JSON.stringify(patch), id],
  }
}
