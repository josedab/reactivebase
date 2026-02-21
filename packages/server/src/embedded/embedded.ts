/**
 * Embedded Postgres adapter for zero-dependency local development.
 * Wraps PGlite (WebAssembly Postgres) to satisfy the pg.Pool interface.
 *
 * Usage:
 *   import { createEmbeddedPool } from "@reactivebase/server/embedded"
 *   const pool = await createEmbeddedPool({ dataDir: ".reactivebase/data" })
 *
 * PGlite must be installed separately: npm install @electric-sql/pglite
 */

export interface EmbeddedPoolOptions {
  /** Directory to store Postgres data. Use "memory://" for in-memory. */
  dataDir?: string
  /** Enable verbose logging */
  debug?: boolean
}

export interface PGliteLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; fields?: unknown[] }>
  close(): Promise<void>
}

/**
 * Adapter that wraps PGlite to match the pg.Pool/PoolClient interface
 * used by ReactiveBase internals.
 */
export class EmbeddedPoolAdapter {
  private pglite: PGliteLike
  private debug: boolean

  constructor(pglite: PGliteLike, options: EmbeddedPoolOptions = {}) {
    this.pglite = pglite
    this.debug = options.debug ?? false
  }

  /**
   * Simulate acquiring a client from the pool.
   * With PGlite, there's only one connection — we return a wrapper.
   */
  async connect(): Promise<EmbeddedClientAdapter> {
    return new EmbeddedClientAdapter(this.pglite, this.debug)
  }

  /**
   * Execute a query directly on the pool.
   */
  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    if (this.debug) {
      console.debug("[PGlite]", sql.substring(0, 200), params)
    }
    const result = await this.pglite.query(sql, params)
    return { rows: result.rows, rowCount: result.rows.length }
  }

  /**
   * Close the embedded database.
   */
  async end(): Promise<void> {
    await this.pglite.close()
  }
}

/**
 * Simulated PoolClient wrapping PGlite.
 */
export class EmbeddedClientAdapter {
  private pglite: PGliteLike
  private debug: boolean

  constructor(pglite: PGliteLike, debug = false) {
    this.pglite = pglite
    this.debug = debug
  }

  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    if (this.debug) {
      console.debug("[PGlite Client]", sql.substring(0, 200), params)
    }
    const result = await this.pglite.query(sql, params)
    return { rows: result.rows, rowCount: result.rows.length }
  }

  release(): void {
    // No-op — PGlite has a single connection
  }
}

/**
 * Create an embedded Postgres pool using PGlite.
 * Dynamically imports @electric-sql/pglite to avoid hard dependency.
 */
export async function createEmbeddedPool(
  options: EmbeddedPoolOptions = {},
): Promise<EmbeddedPoolAdapter> {
  const dataDir = options.dataDir ?? "memory://"

  try {
    // Dynamic import — optional dependency, fails gracefully
    const pgliteModule = await import("@electric-sql/pglite" as string)
    const PGlite = pgliteModule.PGlite ?? pgliteModule.default?.PGlite

    if (!PGlite) {
      throw new Error("Could not find PGlite constructor in @electric-sql/pglite")
    }

    const pglite = new PGlite(dataDir) as PGliteLike
    return new EmbeddedPoolAdapter(pglite, options)
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "ERR_MODULE_NOT_FOUND" ||
        (error as { code?: string }).code === "MODULE_NOT_FOUND") {
      throw new Error(
        "PGlite not installed. Run: npm install @electric-sql/pglite\n" +
        "Or set DATABASE_URL to connect to a real Postgres instance.",
      )
    }
    throw error
  }
}

/**
 * Create a pool from either DATABASE_URL env var or fall back to PGlite.
 * Supports pglite:// connection strings for explicit PGlite usage.
 */
export async function createAutoPool(
  options?: EmbeddedPoolOptions,
): Promise<EmbeddedPoolAdapter | unknown> {
  const dbUrl = process.env.DATABASE_URL

  // Explicit PGlite connection string
  if (dbUrl?.startsWith("pglite://")) {
    const dataDir = dbUrl.replace("pglite://", "") || ".reactivebase/data"
    console.log(`Using embedded PGlite (data: ${dataDir})`)
    return createEmbeddedPool({ ...options, dataDir })
  }

  // Standard Postgres connection string
  if (dbUrl) {
    const pg = await import("pg" as string)
    const Pool = pg.Pool ?? pg.default?.Pool
    return new Pool({ connectionString: dbUrl })
  }

  // Fallback: use PGlite with default data directory
  console.log("No DATABASE_URL found — using embedded PGlite for local development")
  return createEmbeddedPool({
    ...options,
    dataDir: options?.dataDir ?? ".reactivebase/data",
  })
}

/**
 * Check if PGlite is available.
 */
export async function isPGliteAvailable(): Promise<boolean> {
  try {
    await import("@electric-sql/pglite" as string)
    return true
  } catch {
    return false
  }
}
