/**
 * Shared types and constants for the Playground module.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlaygroundSession {
  id: string
  title: string
  code: string
  schemaCode: string
  queryCode: string
  mutationCode: string
  createdAt: number
  updatedAt: number
  /** Execution results for each code block */
  results: ExecutionResult[]
}

export interface ExecutionResult {
  blockId: string
  status: "success" | "error" | "pending"
  output: unknown
  error?: string
  durationMs: number
  timestamp: number
}

export interface TutorialDefinition {
  id: string
  title: string
  description: string
  steps: TutorialStep[]
  estimatedMinutes: number
}

export interface TutorialStep {
  id: string
  title: string
  description: string
  /** Pre-filled code for the editor */
  code: string
  /** Expected output pattern (regex or exact match) */
  expectedOutput?: string
  /** Hints shown when user is stuck */
  hints: string[]
  /** Validation function name to check completion */
  validation: "has-output" | "matches-pattern" | "no-errors" | "custom"
  /** Custom validation pattern */
  validationPattern?: string
}

export interface PlaygroundOptions {
  /** Maximum execution time per block in ms (default: 5000) */
  executionTimeout?: number
  /** Maximum number of stored sessions (default: 50) */
  maxSessions?: number
  /** Enable mock database for sandboxed execution (default: true) */
  useMockDb?: boolean
  /** Custom tutorial definitions */
  tutorials?: TutorialDefinition[]
}

export interface PlaygroundContext {
  /** Mock database tables and their data */
  tables: Record<string, unknown[]>
  /** User-defined variables */
  variables: Record<string, unknown>
  /** Execution log */
  log: LogEntry[]
}

export interface LogEntry {
  level: "info" | "warn" | "error"
  message: string
  timestamp: number
  data?: unknown
}

export interface PlaygroundTemplate {
  id: string
  name: string
  description: string
  schema: string
  queries: string
  mutations: string
  category: "starter" | "realtime" | "collaboration" | "dashboard" | "ai"
}

export interface PlaygroundHTMLOptions {
  title?: string
  theme?: "dark" | "light"
  template?: string
  tutorialId?: string
  serverUrl?: string
  /** Encoded session to restore */
  encodedSession?: string
}

export const DEFAULT_PLAYGROUND_OPTIONS: Required<PlaygroundOptions> = {
  executionTimeout: 5000,
  maxSessions: 50,
  useMockDb: true,
  tutorials: [],
}

export class PlaygroundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PlaygroundError"
  }
}

// ─── Persistence SQL ─────────────────────────────────────────────────────────

export function generatePlaygroundTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_playground_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled',
  schema_code TEXT NOT NULL DEFAULT '',
  query_code TEXT NOT NULL DEFAULT '',
  mutation_code TEXT NOT NULL DEFAULT '',
  results JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playground_sessions_updated
  ON _reactivebase_playground_sessions(updated_at DESC);
`.trim()
}

export function buildSaveSessionSQL(session: PlaygroundSession): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_playground_sessions (id, title, schema_code, query_code, mutation_code, results)
VALUES ($1, $2, $3, $4, $5, $6::jsonb)
ON CONFLICT (id) DO UPDATE SET
  title = $2,
  schema_code = $3,
  query_code = $4,
  mutation_code = $5,
  results = $6::jsonb,
  updated_at = NOW()
RETURNING *`,
    params: [
      session.id,
      session.title,
      session.schemaCode,
      session.queryCode,
      session.mutationCode,
      JSON.stringify(session.results),
    ],
  }
}

export function buildLoadSessionSQL(sessionId: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT * FROM _reactivebase_playground_sessions WHERE id = $1`,
    params: [sessionId],
  }
}

export function buildListSessionsSQL(limit: number = 20): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT id, title, created_at, updated_at FROM _reactivebase_playground_sessions ORDER BY updated_at DESC LIMIT $1`,
    params: [limit],
  }
}

export function buildDeleteSessionSQL(sessionId: string): { sql: string; params: unknown[] } {
  return {
    sql: `DELETE FROM _reactivebase_playground_sessions WHERE id = $1`,
    params: [sessionId],
  }
}
