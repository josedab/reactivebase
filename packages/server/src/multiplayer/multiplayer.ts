// --------------------------------------------------------------------------
// Multiplayer Collaboration Kit
// Turnkey SDK: CRDTs, presence, shared cursors, permissions
// --------------------------------------------------------------------------

// ── Types ──────────────────────────────────────────────────────────────────

export interface MultiplayerUser {
  id: string
  name: string
  avatar?: string
  color: string
  metadata?: Record<string, unknown>
}

export interface CursorPosition {
  userId: string
  x: number
  y: number
  elementId?: string
  field?: string
  offset?: number
  timestamp: number
}

export interface PresenceState {
  userId: string
  status: "online" | "idle" | "away"
  lastSeen: number
  cursor?: CursorPosition
  selection?: SelectionRange
  metadata?: Record<string, unknown>
}

export interface SelectionRange {
  userId: string
  elementId: string
  field?: string
  start: number
  end: number
  timestamp: number
}

export interface MultiplayerPermission {
  userId: string
  roomId: string
  role: "owner" | "editor" | "commenter" | "viewer"
  canEdit: boolean
  canComment: boolean
  canInvite: boolean
}

export interface MultiplayerRoom {
  id: string
  name: string
  createdBy: string
  participants: Map<string, PresenceState>
  permissions: Map<string, MultiplayerPermission>
  documentId: string
  createdAt: number
}

export interface MultiplayerEvent {
  type:
    | "user:join"
    | "user:leave"
    | "cursor:move"
    | "selection:change"
    | "presence:update"
    | "document:change"
    | "permission:change"
  roomId: string
  userId: string
  payload: unknown
  timestamp: number
}

export interface CrdtOperation {
  id: string
  type: "lww-register" | "g-counter" | "pn-counter" | "or-set" | "rga"
  documentId: string
  field: string
  value: unknown
  userId: string
  timestamp: number
  clock: Record<string, number>
}

export interface MultiplayerKitOptions {
  maxRoomSize?: number
  presenceTimeoutMs?: number
  cursorThrottleMs?: number
  enablePersistence?: boolean
}

export interface RoomStats {
  participantCount: number
  activeEditors: number
  operationsPerSecond: number
  latencyMs: number
}

// ── Error ──────────────────────────────────────────────────────────────────

export class MultiplayerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly roomId?: string,
  ) {
    super(message)
    this.name = "MultiplayerError"
  }
}

// ── SQL Builders ───────────────────────────────────────────────────────────

export function buildCreateMultiplayerTablesSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS _rb_mp_rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      document_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS _rb_mp_permissions (
      user_id TEXT NOT NULL,
      room_id TEXT NOT NULL REFERENCES _rb_mp_rooms(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'viewer',
      can_edit BOOLEAN NOT NULL DEFAULT false,
      can_comment BOOLEAN NOT NULL DEFAULT false,
      can_invite BOOLEAN NOT NULL DEFAULT false,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, room_id)
    );

    CREATE TABLE IF NOT EXISTS _rb_mp_operations (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES _rb_mp_rooms(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL,
      field TEXT NOT NULL,
      type TEXT NOT NULL,
      value JSONB,
      user_id TEXT NOT NULL,
      clock JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_mp_ops_room ON _rb_mp_operations (room_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mp_ops_doc ON _rb_mp_operations (document_id, created_at);
  `
}

export function buildInsertRoomSQL(): string {
  return `INSERT INTO _rb_mp_rooms (id, name, created_by, document_id) VALUES ($1, $2, $3, $4)`
}

export function buildUpsertPermissionSQL(): string {
  return `
    INSERT INTO _rb_mp_permissions (user_id, room_id, role, can_edit, can_comment, can_invite)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, room_id) DO UPDATE SET role = $3, can_edit = $4, can_comment = $5, can_invite = $6
  `
}

export function buildGetPermissionSQL(): string {
  return `SELECT user_id, room_id, role, can_edit, can_comment, can_invite FROM _rb_mp_permissions WHERE user_id = $1 AND room_id = $2`
}

export function buildInsertOperationSQL(): string {
  return `INSERT INTO _rb_mp_operations (id, room_id, document_id, field, type, value, user_id, clock) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
}

export function buildGetOperationsSinceSQL(): string {
  return `SELECT id, room_id, document_id, field, type, value, user_id, clock, created_at FROM _rb_mp_operations WHERE room_id = $1 AND created_at > $2 ORDER BY created_at ASC`
}

// ── Presence Tracker ───────────────────────────────────────────────────────

export class PresenceTracker {
  private presence = new Map<string, Map<string, PresenceState>>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly timeoutMs: number = 30000) {
    this.cleanupTimer = setInterval(() => this.cleanup(), timeoutMs)
  }

  update(roomId: string, userId: string, state: Partial<PresenceState>): PresenceState {
    if (!this.presence.has(roomId)) {
      this.presence.set(roomId, new Map())
    }
    const room = this.presence.get(roomId)!
    const existing = room.get(userId) || {
      userId,
      status: "online" as const,
      lastSeen: Date.now(),
    }
    const updated: PresenceState = { ...existing, ...state, lastSeen: Date.now() }
    room.set(userId, updated)
    return updated
  }

  remove(roomId: string, userId: string): void {
    this.presence.get(roomId)?.delete(userId)
  }

  getRoom(roomId: string): PresenceState[] {
    const room = this.presence.get(roomId)
    return room ? Array.from(room.values()) : []
  }

  isOnline(roomId: string, userId: string): boolean {
    const state = this.presence.get(roomId)?.get(userId)
    if (!state) return false
    return Date.now() - state.lastSeen < this.timeoutMs
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [roomId, room] of this.presence) {
      for (const [userId, state] of room) {
        if (now - state.lastSeen > this.timeoutMs) {
          room.delete(userId)
        }
      }
      if (room.size === 0) this.presence.delete(roomId)
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.presence.clear()
  }
}

// ── Cursor Manager ─────────────────────────────────────────────────────────

export class CursorManager {
  private cursors = new Map<string, Map<string, CursorPosition>>()
  private throttleTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly throttleMs: number = 50) {}

  updateCursor(
    roomId: string,
    position: CursorPosition,
    onBroadcast: (roomId: string, cursor: CursorPosition) => void,
  ): void {
    if (!this.cursors.has(roomId)) {
      this.cursors.set(roomId, new Map())
    }
    this.cursors.get(roomId)!.set(position.userId, position)

    const throttleKey = `${roomId}:${position.userId}`
    if (!this.throttleTimers.has(throttleKey)) {
      this.throttleTimers.set(
        throttleKey,
        setTimeout(() => {
          this.throttleTimers.delete(throttleKey)
          const latest = this.cursors.get(roomId)?.get(position.userId)
          if (latest) onBroadcast(roomId, latest)
        }, this.throttleMs),
      )
    }
  }

  getCursors(roomId: string): CursorPosition[] {
    const room = this.cursors.get(roomId)
    return room ? Array.from(room.values()) : []
  }

  removeCursor(roomId: string, userId: string): void {
    this.cursors.get(roomId)?.delete(userId)
  }

  destroy(): void {
    for (const timer of this.throttleTimers.values()) clearTimeout(timer)
    this.throttleTimers.clear()
    this.cursors.clear()
  }
}

// ── Vector Clock ───────────────────────────────────────────────────────────

export function incrementVectorClock(clock: Record<string, number>, nodeId: string): Record<string, number> {
  return { ...clock, [nodeId]: (clock[nodeId] || 0) + 1 }
}

export function mergeVectorClocks(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const merged = { ...a }
  for (const [key, val] of Object.entries(b)) {
    merged[key] = Math.max(merged[key] || 0, val)
  }
  return merged
}

// ── CRDT Document ──────────────────────────────────────────────────────────

export class CrdtDocument {
  private fields = new Map<string, { value: unknown; clock: Record<string, number> }>()

  constructor(public readonly documentId: string) {}

  applyOperation(op: CrdtOperation): void {
    const existing = this.fields.get(op.field)

    switch (op.type) {
      case "lww-register": {
        if (!existing || this.isNewer(op.clock, existing.clock)) {
          this.fields.set(op.field, { value: op.value, clock: op.clock })
        }
        break
      }
      case "g-counter": {
        const current = (existing?.value as number) || 0
        const increment = op.value as number
        this.fields.set(op.field, {
          value: current + increment,
          clock: mergeVectorClocks(existing?.clock || {}, op.clock),
        })
        break
      }
      case "pn-counter": {
        const current = (existing?.value as number) || 0
        const delta = op.value as number
        this.fields.set(op.field, {
          value: current + delta,
          clock: mergeVectorClocks(existing?.clock || {}, op.clock),
        })
        break
      }
      case "or-set": {
        const set = new Set((existing?.value as unknown[]) || [])
        const { action, item } = op.value as { action: "add" | "remove"; item: unknown }
        if (action === "add") set.add(item)
        else set.delete(item)
        this.fields.set(op.field, {
          value: Array.from(set),
          clock: mergeVectorClocks(existing?.clock || {}, op.clock),
        })
        break
      }
      case "rga": {
        const arr = ((existing?.value as unknown[]) || []).slice()
        const { action, index, item } = op.value as {
          action: "insert" | "delete"
          index: number
          item?: unknown
        }
        if (action === "insert" && item !== undefined) {
          arr.splice(Math.min(index, arr.length), 0, item)
        } else if (action === "delete") {
          arr.splice(Math.min(index, arr.length - 1), 1)
        }
        this.fields.set(op.field, {
          value: arr,
          clock: mergeVectorClocks(existing?.clock || {}, op.clock),
        })
        break
      }
    }
  }

  getField(field: string): unknown {
    return this.fields.get(field)?.value
  }

  getSnapshot(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {}
    for (const [key, entry] of this.fields) {
      snapshot[key] = entry.value
    }
    return snapshot
  }

  private isNewer(a: Record<string, number>, b: Record<string, number>): boolean {
    let aGreater = false
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if ((a[key] || 0) < (b[key] || 0)) return false
      if ((a[key] || 0) > (b[key] || 0)) aGreater = true
    }
    return aGreater
  }
}

// ── Multiplayer Kit (Main Engine) ──────────────────────────────────────────

export class MultiplayerKit {
  private readonly rooms = new Map<string, MultiplayerRoom>()
  private readonly documents = new Map<string, CrdtDocument>()
  readonly presence: PresenceTracker
  readonly cursors: CursorManager
  private readonly maxRoomSize: number
  private listeners = new Map<string, Set<(event: MultiplayerEvent) => void>>()

  constructor(options: MultiplayerKitOptions = {}) {
    this.maxRoomSize = options.maxRoomSize ?? 50
    this.presence = new PresenceTracker(options.presenceTimeoutMs ?? 30000)
    this.cursors = new CursorManager(options.cursorThrottleMs ?? 50)
  }

  createRoom(id: string, name: string, createdBy: string, documentId: string): MultiplayerRoom {
    if (this.rooms.has(id)) {
      throw new MultiplayerError(`Room ${id} already exists`, "ROOM_EXISTS", id)
    }

    const room: MultiplayerRoom = {
      id,
      name,
      createdBy,
      participants: new Map(),
      permissions: new Map(),
      documentId,
      createdAt: Date.now(),
    }

    // Grant owner permissions
    room.permissions.set(createdBy, {
      userId: createdBy,
      roomId: id,
      role: "owner",
      canEdit: true,
      canComment: true,
      canInvite: true,
    })

    this.rooms.set(id, room)
    this.documents.set(documentId, new CrdtDocument(documentId))
    return room
  }

  joinRoom(roomId: string, user: MultiplayerUser): PresenceState {
    const room = this.getRoom(roomId)

    if (room.participants.size >= this.maxRoomSize) {
      throw new MultiplayerError("Room is full", "ROOM_FULL", roomId)
    }

    const permission = room.permissions.get(user.id)
    if (!permission) {
      // Default viewer access
      room.permissions.set(user.id, {
        userId: user.id,
        roomId,
        role: "viewer",
        canEdit: false,
        canComment: false,
        canInvite: false,
      })
    }

    const state = this.presence.update(roomId, user.id, {
      status: "online",
      metadata: { name: user.name, avatar: user.avatar, color: user.color },
    })

    room.participants.set(user.id, state)
    this.emit({ type: "user:join", roomId, userId: user.id, payload: user, timestamp: Date.now() })
    return state
  }

  leaveRoom(roomId: string, userId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    room.participants.delete(userId)
    this.presence.remove(roomId, userId)
    this.cursors.removeCursor(roomId, userId)
    this.emit({ type: "user:leave", roomId, userId, payload: null, timestamp: Date.now() })
  }

  updatePermission(
    roomId: string,
    requesterId: string,
    targetUserId: string,
    permission: Partial<MultiplayerPermission>,
  ): MultiplayerPermission {
    const room = this.getRoom(roomId)
    const requesterPerm = room.permissions.get(requesterId)

    if (!requesterPerm || (requesterPerm.role !== "owner" && !requesterPerm.canInvite)) {
      throw new MultiplayerError("Insufficient permissions", "FORBIDDEN", roomId)
    }

    const existing = room.permissions.get(targetUserId) || {
      userId: targetUserId,
      roomId,
      role: "viewer" as const,
      canEdit: false,
      canComment: false,
      canInvite: false,
    }

    const updated = { ...existing, ...permission }
    room.permissions.set(targetUserId, updated)
    this.emit({
      type: "permission:change",
      roomId,
      userId: targetUserId,
      payload: updated,
      timestamp: Date.now(),
    })
    return updated
  }

  applyOperation(roomId: string, userId: string, op: CrdtOperation): void {
    const room = this.getRoom(roomId)
    const perm = room.permissions.get(userId)

    if (!perm?.canEdit) {
      throw new MultiplayerError("No edit permission", "FORBIDDEN", roomId)
    }

    const doc = this.documents.get(room.documentId)
    if (!doc) {
      throw new MultiplayerError("Document not found", "DOC_NOT_FOUND", roomId)
    }

    doc.applyOperation(op)
    this.emit({
      type: "document:change",
      roomId,
      userId,
      payload: op,
      timestamp: Date.now(),
    })
  }

  getDocumentSnapshot(roomId: string): Record<string, unknown> {
    const room = this.getRoom(roomId)
    const doc = this.documents.get(room.documentId)
    if (!doc) {
      throw new MultiplayerError("Document not found", "DOC_NOT_FOUND", roomId)
    }
    return doc.getSnapshot()
  }

  onEvent(roomId: string, listener: (event: MultiplayerEvent) => void): () => void {
    if (!this.listeners.has(roomId)) {
      this.listeners.set(roomId, new Set())
    }
    this.listeners.get(roomId)!.add(listener)
    return () => this.listeners.get(roomId)?.delete(listener)
  }

  getRoomStats(roomId: string): RoomStats {
    const room = this.getRoom(roomId)
    const participants = this.presence.getRoom(roomId)

    return {
      participantCount: participants.length,
      activeEditors: participants.filter((p) => {
        const perm = room.permissions.get(p.userId)
        return perm?.canEdit && p.status === "online"
      }).length,
      operationsPerSecond: 0,
      latencyMs: 0,
    }
  }

  destroy(): void {
    this.presence.destroy()
    this.cursors.destroy()
    this.rooms.clear()
    this.documents.clear()
    this.listeners.clear()
  }

  private getRoom(roomId: string): MultiplayerRoom {
    const room = this.rooms.get(roomId)
    if (!room) {
      throw new MultiplayerError(`Room ${roomId} not found`, "ROOM_NOT_FOUND", roomId)
    }
    return room
  }

  private emit(event: MultiplayerEvent): void {
    const listeners = this.listeners.get(event.roomId)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event)
        } catch {
          // Listener errors shouldn't break the kit
        }
      }
    }
  }
}
