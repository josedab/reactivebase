/**
 * Client-side Session Resumption
 *
 * Extends ConnectionManager with session token management, automatic resume
 * on reconnect, and exponential backoff. Restores subscriptions from
 * server-side snapshots without re-subscribing individually.
 */

import type { ConnectionStatus as _ConnectionStatus } from "../connection/index.js"

export interface SessionResumeOptions {
  /** Enable session resumption (default: true) */
  enabled: boolean
  /** Maximum time to attempt resume before falling back to full re-subscribe */
  resumeTimeoutMs: number
  /** Store session tokens in localStorage for cross-tab resume */
  persistToken: boolean
  /** Storage key for persisted token */
  storageKey: string
}

const DEFAULT_OPTIONS: SessionResumeOptions = {
  enabled: true,
  resumeTimeoutMs: 5_000,
  persistToken: false,
  storageKey: "reactivebase_session_token",
}

export interface SessionState {
  token: string | null
  lastSequence: number
  isResuming: boolean
}

export type ResumeHandler = (result: { success: boolean; restoredSubscriptions: number; missedUpdates: number }) => void

/**
 * Manages client-side session state for stateful reconnection.
 */
export class SessionResumeManager {
  private state: SessionState = { token: null, lastSequence: 0, isResuming: false }
  private options: SessionResumeOptions
  private resumeHandlers = new Set<ResumeHandler>()

  constructor(options: Partial<SessionResumeOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }

    if (this.options.persistToken) {
      this.loadPersistedToken()
    }
  }

  /**
   * Store a session token received from the server.
   */
  setToken(token: string): void {
    this.state.token = token
    if (this.options.persistToken) {
      this.persistToken(token)
    }
  }

  /**
   * Update the last known sequence number from server updates.
   */
  updateSequence(sequence: number): void {
    this.state.lastSequence = sequence
  }

  /**
   * Build the resume handshake message to send on reconnect.
   */
  buildResumeMessage(): { type: "session_resume"; sessionToken: string; lastSequence: number } | null {
    if (!this.options.enabled || !this.state.token) return null

    return {
      type: "session_resume",
      sessionToken: this.state.token,
      lastSequence: this.state.lastSequence,
    }
  }

  /**
   * Handle the server's resume response.
   */
  handleResumeResponse(response: {
    success: boolean
    sessionToken?: string
    missedDeltas?: Array<{ subscriptionId: string; data: unknown; version: number; sequence: number }>
    subscriptionCount?: number
  }): void {
    this.state.isResuming = false

    if (response.success && response.sessionToken) {
      this.setToken(response.sessionToken)
      if (response.missedDeltas?.length) {
        const maxSeq = Math.max(...response.missedDeltas.map((d) => d.sequence))
        this.state.lastSequence = maxSeq
      }
    } else {
      // Resume failed; clear token so client falls back to full re-subscribe
      this.clearToken()
    }

    const result = {
      success: response.success,
      restoredSubscriptions: response.subscriptionCount ?? 0,
      missedUpdates: response.missedDeltas?.length ?? 0,
    }

    for (const handler of this.resumeHandlers) {
      handler(result)
    }
  }

  /**
   * Check if we have a session to resume.
   */
  canResume(): boolean {
    return this.options.enabled && this.state.token !== null
  }

  getState(): Readonly<SessionState> {
    return { ...this.state }
  }

  clearToken(): void {
    this.state.token = null
    this.state.lastSequence = 0
    if (this.options.persistToken) {
      try {
        globalThis.localStorage?.removeItem(this.options.storageKey)
      } catch {
        // localStorage not available
      }
    }
  }

  onResume(handler: ResumeHandler): () => void {
    this.resumeHandlers.add(handler)
    return () => this.resumeHandlers.delete(handler)
  }

  private persistToken(token: string): void {
    try {
      globalThis.localStorage?.setItem(this.options.storageKey, token)
    } catch {
      // localStorage not available
    }
  }

  private loadPersistedToken(): void {
    try {
      const token = globalThis.localStorage?.getItem(this.options.storageKey)
      if (token) this.state.token = token
    } catch {
      // localStorage not available
    }
  }
}
