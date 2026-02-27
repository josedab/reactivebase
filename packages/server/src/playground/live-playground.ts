/**
 * Live Playground Engine — Browser-based playground with PGlite + WebContainers.
 * Provides sandboxed sessions for interactive schema/query/mutation execution,
 * shareable URLs, and real-time subscription state tracking.
 *
 * Usage:
 *   const engine = new LivePlaygroundEngine()
 *   const session = await engine.createSession({ title: "My Session" })
 *   const result = await engine.executeInSession(session.sessionId, "SELECT 1")
 *   const shareUrl = engine.shareSession(session.sessionId)
 */

import type { EmbeddedPoolAdapter } from "../embedded/embedded.js"
import { randomUUID } from "node:crypto"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LivePlaygroundSession {
  sessionId: string
  schema: string
  queryResults: Record<string, unknown[]>
  subscriptionStates: Record<string, unknown>
  createdAt: number
  expiresAt: number
}

export interface ShareableState {
  schema: string
  queries: string
  data: Record<string, unknown[]>
  version: number
}

export interface LivePlaygroundConfig {
  title?: string
  schema?: string
  queries?: string
  /** Session TTL in milliseconds (default: 30 minutes) */
  ttlMs?: number
}

export interface LiveExecutionResult {
  success: boolean
  rows: unknown[]
  error?: string
  durationMs: number
}

export interface LivePlaygroundHTMLOptions {
  title?: string
  theme?: "light" | "dark"
  initialSchema?: string
  initialQuery?: string
  showTutorialSidebar?: boolean
}

// ─── Share state encoding ────────────────────────────────────────────────────

const SHARE_STATE_VERSION = 1

export function encodeShareState(state: ShareableState): string {
  const json = JSON.stringify(state)
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf-8").toString("base64")
  }
  return btoa(json)
}

export function decodeShareState(encoded: string): ShareableState {
  let json: string
  if (typeof Buffer !== "undefined") {
    json = Buffer.from(encoded, "base64").toString("utf-8")
  } else {
    json = atob(encoded)
  }
  let state: ShareableState
  try {
    state = JSON.parse(json) as ShareableState
  } catch {
    throw new Error("Invalid share state: malformed JSON")
  }
  if (!state.schema || typeof state.version !== "number") {
    throw new Error("Invalid share state: missing required fields")
  }
  return state
}

// ─── Live Playground Engine ──────────────────────────────────────────────────

const DEFAULT_TTL_MS = 30 * 60 * 1000 // 30 minutes

export class LivePlaygroundEngine {
  private sessions = new Map<string, LivePlaygroundSession>()
  private pools = new Map<string, EmbeddedPoolAdapter>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Periodic cleanup of expired sessions every 60 seconds
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 60_000)
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  /**
   * Create a sandboxed playground session with an embedded PGlite instance.
   */
  async createSession(config: LivePlaygroundConfig = {}): Promise<LivePlaygroundSession> {
    const sessionId = `live-${randomUUID()}`
    const now = Date.now()
    const ttl = config.ttlMs ?? DEFAULT_TTL_MS

    // Dynamically create an in-memory PGlite pool for isolation
    const { createEmbeddedPool } = await import("../embedded/embedded.js")
    const pool = await createEmbeddedPool({ dataDir: "memory://", debug: false })
    this.pools.set(sessionId, pool)

    // Execute initial schema if provided
    if (config.schema) {
      await pool.query(config.schema)
    }

    const session: LivePlaygroundSession = {
      sessionId,
      schema: config.schema ?? "",
      queryResults: {},
      subscriptionStates: {},
      createdAt: now,
      expiresAt: now + ttl,
    }

    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * Execute SQL/code within a session sandbox.
   */
  async executeInSession(sessionId: string, code: string): Promise<LiveExecutionResult> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return { success: false, rows: [], error: "Session not found", durationMs: 0 }
    }

    const pool = this.pools.get(sessionId)
    if (!pool) {
      return { success: false, rows: [], error: "Session pool not available", durationMs: 0 }
    }

    // Refresh expiry on activity
    session.expiresAt = Date.now() + DEFAULT_TTL_MS

    const start = Date.now()
    try {
      const result = await pool.query(code)
      const rows = result.rows as unknown[]

      // Track query results by first keyword
      const label = code.trim().split(/\s+/)[0]?.toUpperCase() ?? "QUERY"
      session.queryResults[`${label}_${Date.now()}`] = rows

      return { success: true, rows, durationMs: Date.now() - start }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, rows: [], error: message, durationMs: Date.now() - start }
    }
  }

  /**
   * Return current session state including schema, data, and subscription states.
   */
  getSessionState(sessionId: string): LivePlaygroundSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Generate a shareable URL with base64-encoded state.
   */
  shareSession(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined

    const state: ShareableState = {
      schema: session.schema,
      queries: Object.keys(session.queryResults).join("\n"),
      data: session.queryResults,
      version: SHARE_STATE_VERSION,
    }

    const encoded = encodeShareState(state)
    return `https://playground.reactivebase.dev/share?state=${encoded}`
  }

  /**
   * Restore a session from a shared URL.
   */
  async importFromUrl(shareUrl: string): Promise<LivePlaygroundSession> {
    const url = new URL(shareUrl)
    const encoded = url.searchParams.get("state")
    if (!encoded) throw new Error("No state parameter found in URL")

    const state = decodeShareState(encoded)
    return this.createSession({ schema: state.schema })
  }

  /**
   * Destroy a session and release its resources.
   */
  async destroySession(sessionId: string): Promise<boolean> {
    const pool = this.pools.get(sessionId)
    if (pool) {
      await pool.end()
      this.pools.delete(sessionId)
    }
    return this.sessions.delete(sessionId)
  }

  /**
   * Clean up expired sessions.
   */
  private async cleanupExpired(): Promise<void> {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        await this.destroySession(id)
      }
    }
  }

  /**
   * Stop the cleanup timer and destroy all sessions.
   */
  async dispose(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    for (const id of [...this.sessions.keys()]) {
      await this.destroySession(id)
    }
  }
}

// ─── HTML Generation ─────────────────────────────────────────────────────────

export function generateLivePlaygroundHTML(options: LivePlaygroundHTMLOptions = {}): string {
  const {
    title = "ReactiveBase Live Playground",
    theme = "dark",
    initialSchema = "",
    initialQuery = "",
    showTutorialSidebar = true,
  } = options

  const escapedSchema = escapeHTML(initialSchema)
  const escapedQuery = escapeHTML(initialQuery)

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHTML(title)}</title>
  <style>
    :root { --bg: ${theme === "dark" ? "#1e1e2e" : "#ffffff"}; --fg: ${theme === "dark" ? "#cdd6f4" : "#1e1e2e"}; --border: ${theme === "dark" ? "#45475a" : "#ddd"}; --accent: #89b4fa; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'SF Mono', 'Fira Code', monospace; background: var(--bg); color: var(--fg); display: flex; height: 100vh; }
    .panel { flex: 1; display: flex; flex-direction: column; border-right: 1px solid var(--border); }
    .panel-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; }
    .panel-body { flex: 1; padding: 16px; overflow: auto; }
    textarea { width: 100%; height: 100%; background: transparent; color: var(--fg); border: none; resize: none; font-family: inherit; font-size: 14px; outline: none; }
    #schema-editor { border-right: 1px solid var(--border); }
    #query-panel { }
    #results-panel { }
    #tutorial-sidebar { width: 280px; min-width: 280px; border-left: 1px solid var(--border); display: ${showTutorialSidebar ? "flex" : "none"}; flex-direction: column; }
    .btn { padding: 8px 16px; background: var(--accent); color: #1e1e2e; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600; }
    .btn:hover { opacity: 0.9; }
    .results-output { font-size: 13px; white-space: pre-wrap; }
    .tutorial-step { padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: pointer; }
    .tutorial-step:hover { background: rgba(137,180,250,0.1); }
    .tutorial-step.active { border-left: 3px solid var(--accent); }
  </style>
</head>
<body>
  <!-- Schema Editor Panel -->
  <div class="panel" id="schema-editor">
    <div class="panel-header">Schema Editor</div>
    <div class="panel-body">
      <textarea id="schema-input" placeholder="Define your schema here...">${escapedSchema}</textarea>
    </div>
  </div>

  <!-- Query / Mutation Panel -->
  <div class="panel" id="query-panel">
    <div class="panel-header">
      Query / Mutation
      <button class="btn" onclick="executeQuery()" style="float:right;margin-top:-4px;">Run ▶</button>
    </div>
    <div class="panel-body">
      <textarea id="query-input" placeholder="Write queries or mutations...">${escapedQuery}</textarea>
    </div>
  </div>

  <!-- Real-time Results Panel -->
  <div class="panel" id="results-panel">
    <div class="panel-header">Results &amp; Subscriptions</div>
    <div class="panel-body">
      <div id="results-output" class="results-output">Run a query to see results...</div>
    </div>
  </div>

  <!-- Tutorial Sidebar -->
  <div id="tutorial-sidebar">
    <div class="panel-header">Tutorial</div>
    <div class="panel-body" id="tutorial-steps">
      <div class="tutorial-step active">
        <strong>Step 1:</strong> Define a Schema
      </div>
      <div class="tutorial-step">
        <strong>Step 2:</strong> Write a Query
      </div>
      <div class="tutorial-step">
        <strong>Step 3:</strong> Create a Mutation
      </div>
      <div class="tutorial-step">
        <strong>Step 4:</strong> Subscribe to Changes
      </div>
    </div>
  </div>

  <script>
    async function executeQuery() {
      const query = document.getElementById('query-input').value;
      const output = document.getElementById('results-output');
      output.textContent = 'Executing...';
      try {
        const res = await fetch('/api/playground/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: query }),
        });
        const data = await res.json();
        output.textContent = JSON.stringify(data, null, 2);
      } catch (err: unknown) {
        output.textContent = 'Error: ' + err.message;
      }
    }
  </script>
</body>
</html>`
}

function escapeHTML(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
