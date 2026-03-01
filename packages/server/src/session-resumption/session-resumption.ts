/**
 * Stateful Session Resumption Protocol (Server-Side)
 *
 * Allows clients to reconnect after network interruption without re-subscribing.
 * Maintains session tokens with server-side subscription snapshots and delivers
 * only the missed deltas on resumption for <100ms restore.
 */

import { randomBytes } from "crypto"

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionSnapshot {
  readonly sessionToken: string
  readonly connectionId: string
  subscriptions: SubscriptionSnapshot[]
  lastSequence: number
  createdAt: Date
  lastActiveAt: Date
  expiresAt: Date
}

export interface SubscriptionSnapshot {
  readonly subscriptionId: string
  readonly queryName: string
  readonly args: unknown
  lastVersion: number
  lastResultHash: string
}

export interface DeltaEntry {
  readonly sequence: number
  readonly subscriptionId: string
  readonly data: unknown
  readonly version: number
  readonly timestamp: Date
}

export interface SessionStoreOptions {
  sessionTTLMs: number
  maxDeltasPerSession: number
  maxSessions: number
  cleanupIntervalMs: number
}

const DEFAULT_OPTIONS: SessionStoreOptions = {
  sessionTTLMs: 5 * 60 * 1000, // 5 minutes
  maxDeltasPerSession: 1000,
  maxSessions: 10_000,
  cleanupIntervalMs: 60_000,
}

export interface ResumptionResult {
  success: boolean
  sessionToken: string
  missedDeltas: DeltaEntry[]
  subscriptions: SubscriptionSnapshot[]
  error?: string
}

// ── Session Store ────────────────────────────────────────────────────────────

export class SessionStore {
  private sessions = new Map<string, SessionSnapshot>()
  private deltas = new Map<string, DeltaEntry[]>()
  private options: SessionStoreOptions
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: Partial<SessionStoreOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Create a new session for a connection.
   */
  createSession(connectionId: string): SessionSnapshot {
    const token = this.generateToken()
    const now = new Date()

    const session: SessionSnapshot = {
      sessionToken: token,
      connectionId,
      subscriptions: [],
      lastSequence: 0,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + this.options.sessionTTLMs),
    }

    this.sessions.set(token, session)
    this.deltas.set(token, [])

    // Evict oldest sessions if limit exceeded
    if (this.sessions.size > this.options.maxSessions) {
      this.evictOldest()
    }

    return session
  }

  /**
   * Record a subscription for a session.
   */
  addSubscription(sessionToken: string, sub: SubscriptionSnapshot): void {
    const session = this.sessions.get(sessionToken)
    if (!session) return

    const existing = session.subscriptions.findIndex((s) => s.subscriptionId === sub.subscriptionId)
    if (existing >= 0) {
      session.subscriptions[existing] = sub
    } else {
      session.subscriptions.push(sub)
    }
    session.lastActiveAt = new Date()
  }

  /**
   * Remove a subscription from a session.
   */
  removeSubscription(sessionToken: string, subscriptionId: string): void {
    const session = this.sessions.get(sessionToken)
    if (!session) return
    session.subscriptions = session.subscriptions.filter((s) => s.subscriptionId !== subscriptionId)
  }

  /**
   * Record a delta (subscription update) for later delivery on resume.
   */
  recordDelta(sessionToken: string, delta: Omit<DeltaEntry, "sequence" | "timestamp">): void {
    const session = this.sessions.get(sessionToken)
    if (!session) return

    const deltas = this.deltas.get(sessionToken)
    if (!deltas) return

    session.lastSequence++
    const entry: DeltaEntry = {
      ...delta,
      sequence: session.lastSequence,
      timestamp: new Date(),
    }

    deltas.push(entry)

    // Trim old deltas
    if (deltas.length > this.options.maxDeltasPerSession) {
      deltas.splice(0, deltas.length - this.options.maxDeltasPerSession)
    }

    // Update subscription snapshot
    const sub = session.subscriptions.find((s) => s.subscriptionId === delta.subscriptionId)
    if (sub) {
      (sub as { lastVersion: number }).lastVersion = delta.version
    }
  }

  /**
   * Attempt to resume a session with a token.
   * Returns missed deltas since the given sequence number.
   */
  resumeSession(sessionToken: string, lastKnownSequence: number): ResumptionResult {
    const session = this.sessions.get(sessionToken)

    if (!session) {
      return {
        success: false,
        sessionToken,
        missedDeltas: [],
        subscriptions: [],
        error: "Session not found or expired",
      }
    }

    if (session.expiresAt < new Date()) {
      this.destroySession(sessionToken)
      return {
        success: false,
        sessionToken,
        missedDeltas: [],
        subscriptions: [],
        error: "Session expired",
      }
    }

    const allDeltas = this.deltas.get(sessionToken) ?? []
    const missedDeltas = allDeltas.filter((d) => d.sequence > lastKnownSequence)

    // Refresh session
    session.lastActiveAt = new Date()
    session.expiresAt = new Date(Date.now() + this.options.sessionTTLMs)

    return {
      success: true,
      sessionToken,
      missedDeltas,
      subscriptions: session.subscriptions,
    }
  }

  /**
   * Destroy a session and its deltas.
   */
  destroySession(sessionToken: string): void {
    this.sessions.delete(sessionToken)
    this.deltas.delete(sessionToken)
  }

  getSession(sessionToken: string): SessionSnapshot | undefined {
    return this.sessions.get(sessionToken)
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  /**
   * Start periodic cleanup of expired sessions.
   */
  startCleanup(): void {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), this.options.cleanupIntervalMs)
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private cleanupExpired(): void {
    const now = new Date()
    for (const [token, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.destroySession(token)
      }
    }
  }

  private evictOldest(): void {
    let oldestToken: string | null = null
    let oldestTime = Infinity

    for (const [token, session] of this.sessions) {
      if (session.lastActiveAt.getTime() < oldestTime) {
        oldestTime = session.lastActiveAt.getTime()
        oldestToken = token
      }
    }

    if (oldestToken) {
      this.destroySession(oldestToken)
    }
  }

  private generateToken(): string {
    return randomBytes(32).toString("hex")
  }
}
