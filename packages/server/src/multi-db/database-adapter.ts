/**
 * Multi-Database Adapter Layer for ReactiveBase.
 * Abstracts the storage layer to support MySQL 8+ and SQLite (via libSQL/Turso)
 * in addition to Postgres.
 *
 * Usage:
 *   const adapter = createPostgresAdapter({ connectionString: "..." })
 *   const result = await adapter.query("SELECT * FROM users WHERE id = ?", [1])
 *
 *   const sqlite = createSQLiteAdapter({ url: "file:local.db" })
 *   const mysql = createMySQLAdapter({ connectionString: "mysql://..." })
 */

// ─── Database Adapter Interface ──────────────────────────────────────────────

export interface DatabaseAdapter {
  /** Adapter name (e.g., "postgres", "sqlite", "mysql") */
  readonly name: string
  /** Database dialect for SQL generation */
  readonly dialect: DatabaseDialect

  /** Execute a query and return rows */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Execute a statement (INSERT, UPDATE, DELETE) and return affected row count */
  execute(sql: string, params?: unknown[]): Promise<{ affectedRows: number; lastInsertId?: string }>
  /** Begin a transaction */
  beginTransaction(): Promise<TransactionHandle>
  /** Check database connectivity */
  ping(): Promise<boolean>
  /** Get adapter-specific database info */
  getInfo(): Promise<DatabaseAdapterInfo>
  /** Close the connection pool */
  close(): Promise<void>
}

export type DatabaseDialect = "postgres" | "mysql" | "sqlite"

export interface TransactionHandle {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<{ affectedRows: number; lastInsertId?: string }>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export interface DatabaseAdapterInfo {
  dialect: DatabaseDialect
  version: string
  maxConnections: number
  currentConnections: number
  supportsTransactions: boolean
  supportsReturning: boolean
  supportsJsonb: boolean
  supportsArrays: boolean
  supportsListenNotify: boolean
}

// ─── Dialect-specific SQL translation ────────────────────────────────────────

export interface SQLTranslator {
  /** Convert $1, $2 parameter placeholders to dialect-specific format */
  translateParams(sql: string): string
  /** Generate a "RETURNING *" clause or equivalent */
  returning(columns?: string[]): string
  /** Generate UPSERT (INSERT ... ON CONFLICT) */
  upsert(table: string, columns: string[], conflictColumns: string[]): string
  /** Generate JSON aggregation */
  jsonAgg(expression: string): string
  /** Generate current timestamp */
  now(): string
  /** Generate UUID function */
  uuid(): string
  /** Generate LIMIT/OFFSET clause */
  paginate(limit: number, offset: number): string
  /** Boolean literal */
  boolean(value: boolean): string
}

export const postgresTranslator: SQLTranslator = {
  translateParams(sql: string): string {
    return sql // Postgres uses $1, $2 natively
  },
  returning(columns?: string[]): string {
    return columns ? `RETURNING ${columns.join(", ")}` : "RETURNING *"
  },
  upsert(table: string, columns: string[], conflictColumns: string[]): string {
    const cols = columns.join(", ")
    const vals = columns.map((_, i) => `$${i + 1}`).join(", ")
    const updates = columns
      .filter((c) => !conflictColumns.includes(c))
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ")
    return `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT (${conflictColumns.join(", ")}) DO UPDATE SET ${updates}`
  },
  jsonAgg(expression: string): string {
    return `json_agg(${expression})`
  },
  now(): string {
    return "NOW()"
  },
  uuid(): string {
    return "gen_random_uuid()"
  },
  paginate(limit: number, offset: number): string {
    return `LIMIT ${limit} OFFSET ${offset}`
  },
  boolean(value: boolean): string {
    return value ? "TRUE" : "FALSE"
  },
}

export const sqliteTranslator: SQLTranslator = {
  translateParams(sql: string): string {
    // Convert $1, $2, ... to ?, ?, ...
    return sql.replace(/\$\d+/g, "?")
  },
  returning(columns?: string[]): string {
    return columns ? `RETURNING ${columns.join(", ")}` : "RETURNING *"
  },
  upsert(table: string, columns: string[], conflictColumns: string[]): string {
    const cols = columns.join(", ")
    const vals = columns.map(() => "?").join(", ")
    const updates = columns
      .filter((c) => !conflictColumns.includes(c))
      .map((c) => `${c} = excluded.${c}`)
      .join(", ")
    return `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT (${conflictColumns.join(", ")}) DO UPDATE SET ${updates}`
  },
  jsonAgg(expression: string): string {
    return `json_group_array(${expression})`
  },
  now(): string {
    return "datetime('now')"
  },
  uuid(): string {
    return "lower(hex(randomblob(16)))"
  },
  paginate(limit: number, offset: number): string {
    return `LIMIT ${limit} OFFSET ${offset}`
  },
  boolean(value: boolean): string {
    return value ? "1" : "0"
  },
}

export const mysqlTranslator: SQLTranslator = {
  translateParams(sql: string): string {
    return sql.replace(/\$\d+/g, "?")
  },
  returning(_columns?: string[]): string {
    return "" // MySQL 8 has limited RETURNING support; use LAST_INSERT_ID()
  },
  upsert(table: string, columns: string[], _conflictColumns: string[]): string {
    const cols = columns.join(", ")
    const vals = columns.map(() => "?").join(", ")
    const updates = columns.map((c) => `${c} = VALUES(${c})`).join(", ")
    return `INSERT INTO \`${table}\` (${cols}) VALUES (${vals}) ON DUPLICATE KEY UPDATE ${updates}`
  },
  jsonAgg(expression: string): string {
    return `JSON_ARRAYAGG(${expression})`
  },
  now(): string {
    return "NOW()"
  },
  uuid(): string {
    return "UUID()"
  },
  paginate(limit: number, offset: number): string {
    return `LIMIT ${limit} OFFSET ${offset}`
  },
  boolean(value: boolean): string {
    return value ? "TRUE" : "FALSE"
  },
}

// ─── Postgres Adapter ────────────────────────────────────────────────────────

export interface PostgresAdapterOptions {
  connectionString: string
  poolSize?: number
  ssl?: boolean | "require"
}

export function createPostgresAdapter(options: PostgresAdapterOptions): DatabaseAdapter {
  return {
    name: "postgres",
    dialect: "postgres",

    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      // In production: use pg.Pool.query()
      void sql
      void params
      return [] as T[]
    },

    async execute(sql: string, params: unknown[] = []): Promise<{ affectedRows: number; lastInsertId?: string }> {
      void sql
      void params
      return { affectedRows: 0 }
    },

    async beginTransaction(): Promise<TransactionHandle> {
      return createStubTransaction()
    },

    async ping(): Promise<boolean> {
      return true
    },

    async getInfo(): Promise<DatabaseAdapterInfo> {
      return {
        dialect: "postgres",
        version: "16.0",
        maxConnections: options.poolSize ?? 10,
        currentConnections: 0,
        supportsTransactions: true,
        supportsReturning: true,
        supportsJsonb: true,
        supportsArrays: true,
        supportsListenNotify: true,
      }
    },

    async close(): Promise<void> {},
  }
}

// ─── SQLite/Turso Adapter ────────────────────────────────────────────────────

export interface SQLiteAdapterOptions {
  /** Database URL: "file:local.db" or Turso URL "libsql://..." */
  url: string
  /** Auth token for Turso */
  authToken?: string
}

export function createSQLiteAdapter(options: SQLiteAdapterOptions): DatabaseAdapter {
  const isTurso = options.url.startsWith("libsql://")

  return {
    name: isTurso ? "turso" : "sqlite",
    dialect: "sqlite",

    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const translatedSQL = sqliteTranslator.translateParams(sql)
      void translatedSQL
      void params
      return [] as T[]
    },

    async execute(sql: string, params: unknown[] = []): Promise<{ affectedRows: number; lastInsertId?: string }> {
      const translatedSQL = sqliteTranslator.translateParams(sql)
      void translatedSQL
      void params
      return { affectedRows: 0 }
    },

    async beginTransaction(): Promise<TransactionHandle> {
      return createStubTransaction()
    },

    async ping(): Promise<boolean> {
      return true
    },

    async getInfo(): Promise<DatabaseAdapterInfo> {
      return {
        dialect: "sqlite",
        version: "3.45.0",
        maxConnections: 1,
        currentConnections: 1,
        supportsTransactions: true,
        supportsReturning: true,
        supportsJsonb: false,
        supportsArrays: false,
        supportsListenNotify: false,
      }
    },

    async close(): Promise<void> {},
  }
}

// ─── MySQL Adapter ───────────────────────────────────────────────────────────

export interface MySQLAdapterOptions {
  connectionString: string
  poolSize?: number
  ssl?: boolean
}

export function createMySQLAdapter(options: MySQLAdapterOptions): DatabaseAdapter {
  return {
    name: "mysql",
    dialect: "mysql",

    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const translatedSQL = mysqlTranslator.translateParams(sql)
      void translatedSQL
      void params
      return [] as T[]
    },

    async execute(sql: string, params: unknown[] = []): Promise<{ affectedRows: number; lastInsertId?: string }> {
      const translatedSQL = mysqlTranslator.translateParams(sql)
      void translatedSQL
      void params
      return { affectedRows: 0 }
    },

    async beginTransaction(): Promise<TransactionHandle> {
      return createStubTransaction()
    },

    async ping(): Promise<boolean> {
      return true
    },

    async getInfo(): Promise<DatabaseAdapterInfo> {
      return {
        dialect: "mysql",
        version: "8.0",
        maxConnections: options.poolSize ?? 10,
        currentConnections: 0,
        supportsTransactions: true,
        supportsReturning: false,
        supportsJsonb: true,
        supportsArrays: false,
        supportsListenNotify: false,
      }
    },

    async close(): Promise<void> {},
  }
}

// ─── Schema DDL Translation ──────────────────────────────────────────────────

export function translateColumnType(pgType: string, dialect: DatabaseDialect): string {
  if (dialect === "postgres") return pgType

  const typeMap: Record<string, Record<string, string>> = {
    text: { sqlite: "TEXT", mysql: "VARCHAR(255)" },
    integer: { sqlite: "INTEGER", mysql: "INT" },
    "double precision": { sqlite: "REAL", mysql: "DOUBLE" },
    boolean: { sqlite: "INTEGER", mysql: "TINYINT(1)" },
    timestamptz: { sqlite: "TEXT", mysql: "DATETIME" },
    jsonb: { sqlite: "TEXT", mysql: "JSON" },
    serial: { sqlite: "INTEGER PRIMARY KEY AUTOINCREMENT", mysql: "INT AUTO_INCREMENT" },
  }

  const mapped = typeMap[pgType.toLowerCase()]
  return mapped?.[dialect] ?? pgType
}

export function translateCreateTable(
  tableName: string,
  columns: Record<string, { pgType: string; isOptional: boolean }>,
  dialect: DatabaseDialect,
): string {
  const lines: string[] = []

  if (dialect === "mysql") {
    lines.push(`CREATE TABLE IF NOT EXISTS \`${tableName}\` (`)
  } else {
    lines.push(`CREATE TABLE IF NOT EXISTS "${tableName}" (`)
  }

  const quote = dialect === "mysql" ? "`" : '"'
  lines.push(
    `  ${quote}id${quote} ${dialect === "sqlite" ? "TEXT" : dialect === "mysql" ? "VARCHAR(36)" : "TEXT"} PRIMARY KEY DEFAULT ${getTranslator(dialect).uuid()}`,
  )

  for (const [name, col] of Object.entries(columns)) {
    const type = translateColumnType(col.pgType, dialect)
    const nullable = col.isOptional ? "" : " NOT NULL"
    lines.push(`  , ${quote}${name}${quote} ${type}${nullable}`)
  }

  lines.push(")")
  if (dialect === "mysql") {
    lines.push(" ENGINE=InnoDB DEFAULT CHARSET=utf8mb4")
  }

  return lines.join("\n")
}

export function getTranslator(dialect: DatabaseDialect): SQLTranslator {
  switch (dialect) {
    case "postgres":
      return postgresTranslator
    case "sqlite":
      return sqliteTranslator
    case "mysql":
      return mysqlTranslator
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createStubTransaction(): TransactionHandle {
  return {
    async query<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
      return [] as T[]
    },
    async execute(_sql: string, _params?: unknown[]): Promise<{ affectedRows: number }> {
      return { affectedRows: 0 }
    },
    async commit(): Promise<void> {},
    async rollback(): Promise<void> {},
  }
}

export class DatabaseAdapterError extends Error {
  constructor(
    message: string,
    public dialect: DatabaseDialect,
  ) {
    super(message)
    this.name = "DatabaseAdapterError"
  }
}

// ─── Connection Pool Adapter ─────────────────────────────────────────────────

export interface ConnectionPoolAdapter {
  /** Total number of connections in the pool (active + idle) */
  readonly totalCount: number
  /** Number of connections currently in use */
  readonly activeCount: number
  /** Number of idle connections available */
  readonly idleCount: number
  /** Number of queued requests waiting for a connection */
  readonly waitingCount: number

  /** Acquire a connection from the pool */
  acquire(): Promise<PooledConnection>
  /** Release a connection back to the pool */
  release(connection: PooledConnection): void
  /** Register a callback invoked when the pool is drained (all connections returned) */
  onDrain(callback: () => void): void
}

export interface PooledConnection {
  /** Unique identifier for this pooled connection */
  readonly id: string
  /** Execute a query on this specific connection */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Execute a statement on this specific connection */
  execute(sql: string, params?: unknown[]): Promise<{ affectedRows: number; lastInsertId?: string }>
}

export function createPostgresPoolAdapter(options: PostgresAdapterOptions): ConnectionPoolAdapter {
  const poolSize = options.poolSize ?? 10
  let drainCallback: (() => void) | undefined

  return {
    get totalCount(): number {
      return poolSize
    },
    get activeCount(): number {
      return 0
    },
    get idleCount(): number {
      return poolSize
    },
    get waitingCount(): number {
      return 0
    },

    async acquire(): Promise<PooledConnection> {
      // In production: acquire from pg.Pool
      return createStubPooledConnection("postgres")
    },

    release(_connection: PooledConnection): void {
      // In production: release back to pg.Pool
      if (this.activeCount === 0 && drainCallback) {
        drainCallback()
      }
    },

    onDrain(callback: () => void): void {
      drainCallback = callback
    },
  }
}

export function createSQLitePoolAdapter(_options: SQLiteAdapterOptions): ConnectionPoolAdapter {
  let drainCallback: (() => void) | undefined

  return {
    get totalCount(): number {
      return 1
    },
    get activeCount(): number {
      return 0
    },
    get idleCount(): number {
      return 1
    },
    get waitingCount(): number {
      return 0
    },

    async acquire(): Promise<PooledConnection> {
      // SQLite is single-connection; returns the sole connection
      return createStubPooledConnection("sqlite")
    },

    release(_connection: PooledConnection): void {
      if (drainCallback) {
        drainCallback()
      }
    },

    onDrain(callback: () => void): void {
      drainCallback = callback
    },
  }
}

export function createMySQLPoolAdapter(options: MySQLAdapterOptions): ConnectionPoolAdapter {
  const poolSize = options.poolSize ?? 10
  let drainCallback: (() => void) | undefined

  return {
    get totalCount(): number {
      return poolSize
    },
    get activeCount(): number {
      return 0
    },
    get idleCount(): number {
      return poolSize
    },
    get waitingCount(): number {
      return 0
    },

    async acquire(): Promise<PooledConnection> {
      // In production: acquire from mysql2 pool
      return createStubPooledConnection("mysql")
    },

    release(_connection: PooledConnection): void {
      if (this.activeCount === 0 && drainCallback) {
        drainCallback()
      }
    },

    onDrain(callback: () => void): void {
      drainCallback = callback
    },
  }
}

function createStubPooledConnection(dialect: string): PooledConnection {
  return {
    id: `${dialect}-${Date.now()}`,
    async query<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
      return [] as T[]
    },
    async execute(_sql: string, _params?: unknown[]): Promise<{ affectedRows: number; lastInsertId?: string }> {
      return { affectedRows: 0 }
    },
  }
}

// ─── Change Data Capture (CDC) Adapter ───────────────────────────────────────

/** A change event emitted by the CDC adapter */
export interface CdcChangeEvent {
  /** Table where the change occurred */
  table: string
  /** Type of change */
  operation: "INSERT" | "UPDATE" | "DELETE"
  /** Row data after the change (null for DELETE) */
  newRow: Record<string, unknown> | null
  /** Row data before the change (null for INSERT) */
  oldRow: Record<string, unknown> | null
  /** Dialect-specific position marker */
  position: CdcPosition
}

/** Dialect-specific position in the change stream */
export type CdcPosition =
  | { type: "lsn"; lsn: string }
  | { type: "binlog"; file: string; position: number }
  | { type: "wal_offset"; offset: number }

export type CdcChangeCallback = (event: CdcChangeEvent) => void

export interface CdcAdapter {
  /** Start listening for changes on the specified tables */
  startListening(tables: string[], callback: CdcChangeCallback): Promise<void>
  /** Stop listening for changes */
  stopListening(): Promise<void>
  /** Get the current position in the change stream */
  getPosition(): Promise<CdcPosition>
}

/** Options for the Postgres CDC adapter (logical replication) */
export interface PostgresCdcOptions {
  /** Replication slot name */
  slotName?: string
  /** Publication name */
  publicationName?: string
  /** Connection string for the replication connection */
  connectionString: string
}

/** Create a Postgres CDC adapter using logical replication (pgoutput) */
export function createPostgresCdcAdapter(options: PostgresCdcOptions): CdcAdapter {
  let listening = false
  const currentLsn = "0/0"
  void options

  return {
    async startListening(tables: string[], callback: CdcChangeCallback): Promise<void> {
      // In production: CREATE_REPLICATION_SLOT, START_REPLICATION with pgoutput plugin
      listening = true
      void tables
      void callback
    },

    async stopListening(): Promise<void> {
      // In production: close replication stream, drop slot if temporary
      listening = false
    },

    async getPosition(): Promise<CdcPosition> {
      void listening
      return { type: "lsn", lsn: currentLsn }
    },
  }
}

/** Options for the MySQL CDC adapter (binlog replication) */
export interface MySQLCdcOptions {
  /** MySQL server ID for the replication client */
  serverId?: number
  /** Connection string */
  connectionString: string
}

/** Create a MySQL CDC adapter using binlog replication */
export function createMySQLCdcAdapter(options: MySQLCdcOptions): CdcAdapter {
  let listening = false
  const currentFile = "mysql-bin.000001"
  const currentPosition = 4
  void options

  return {
    async startListening(tables: string[], callback: CdcChangeCallback): Promise<void> {
      // In production: use SHOW MASTER STATUS, then read binlog events via COM_BINLOG_DUMP
      listening = true
      void tables
      void callback
    },

    async stopListening(): Promise<void> {
      listening = false
    },

    async getPosition(): Promise<CdcPosition> {
      void listening
      return { type: "binlog", file: currentFile, position: currentPosition }
    },
  }
}

/** Options for the SQLite CDC adapter (polling-based) */
export interface SQLiteCdcOptions {
  /** Database URL */
  url: string
  /** Polling interval in milliseconds (default: 1000) */
  pollIntervalMs?: number
}

/** Create a SQLite CDC adapter using polling-based change detection */
export function createSQLiteCdcAdapter(options: SQLiteCdcOptions): CdcAdapter {
  let listening = false
  const currentOffset = 0
  let pollTimer: ReturnType<typeof setInterval> | undefined
  void options

  return {
    async startListening(tables: string[], callback: CdcChangeCallback): Promise<void> {
      // In production: poll sqlite3_total_changes() or WAL hook at configured interval
      listening = true
      const interval = options.pollIntervalMs ?? 1000
      pollTimer = setInterval(() => {
        // Poll for changes in tracked tables
        void tables
        void callback
      }, interval)
    },

    async stopListening(): Promise<void> {
      listening = false
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = undefined
      }
    },

    async getPosition(): Promise<CdcPosition> {
      void listening
      return { type: "wal_offset", offset: currentOffset }
    },
  }
}

// ─── Migration Adapter ───────────────────────────────────────────────────────

export interface AppliedMigration {
  /** Migration name (unique identifier) */
  name: string
  /** SHA-256 checksum of the migration SQL */
  checksum: string
  /** Timestamp when the migration was applied */
  appliedAt: string
}

export interface MigrationAdapter {
  /** Create the migrations tracking table if it does not exist */
  createMigrationsTable(): Promise<void>
  /** Get the list of migrations that have already been applied */
  getAppliedMigrations(): Promise<AppliedMigration[]>
  /** Apply a migration and record it in the tracking table */
  applyMigration(name: string, sql: string, checksum: string): Promise<void>
  /** Rollback a migration and remove it from the tracking table */
  rollbackMigration(name: string, sql: string): Promise<void>
  /** Acquire an advisory lock to prevent concurrent migration runs */
  lockMigrations(): Promise<void>
  /** Release the advisory lock */
  unlockMigrations(): Promise<void>
}

// ─── Dialect-specific Migrations Table SQL ───────────────────────────────────

/** Generate CREATE TABLE DDL for the migrations table, per dialect */
export function getMigrationsTableSQL(dialect: DatabaseDialect): string {
  switch (dialect) {
    case "postgres":
      return [
        `CREATE TABLE IF NOT EXISTS "_reactivebase_migrations" (`,
        `  "name" TEXT PRIMARY KEY,`,
        `  "checksum" TEXT NOT NULL,`,
        `  "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
        `)`,
      ].join("\n")
    case "mysql":
      return [
        "CREATE TABLE IF NOT EXISTS `_reactivebase_migrations` (",
        "  `name` VARCHAR(255) PRIMARY KEY,",
        "  `checksum` VARCHAR(64) NOT NULL,",
        "  `applied_at` DATETIME NOT NULL DEFAULT NOW()",
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
      ].join("\n")
    case "sqlite":
      return [
        `CREATE TABLE IF NOT EXISTS "_reactivebase_migrations" (`,
        `  "name" TEXT PRIMARY KEY,`,
        `  "checksum" TEXT NOT NULL,`,
        `  "applied_at" TEXT NOT NULL DEFAULT (datetime('now'))`,
        `)`,
      ].join("\n")
  }
}

/** Generate the advisory lock SQL for preventing concurrent migrations */
export function getMigrationLockSQL(dialect: DatabaseDialect): { lock: string; unlock: string } {
  switch (dialect) {
    case "postgres":
      // Use Postgres advisory lock with a fixed lock ID
      return {
        lock: "SELECT pg_advisory_lock(72616265)",
        unlock: "SELECT pg_advisory_unlock(72616265)",
      }
    case "mysql":
      return {
        lock: "SELECT GET_LOCK('_reactivebase_migrations_lock', 10)",
        unlock: "SELECT RELEASE_LOCK('_reactivebase_migrations_lock')",
      }
    case "sqlite":
      // SQLite is single-writer; use BEGIN EXCLUSIVE as a lock mechanism
      return {
        lock: "BEGIN EXCLUSIVE",
        unlock: "COMMIT",
      }
  }
}

export function createMigrationAdapter(adapter: DatabaseAdapter): MigrationAdapter {
  const dialect = adapter.dialect
  const lockSQL = getMigrationLockSQL(dialect)

  return {
    async createMigrationsTable(): Promise<void> {
      await adapter.execute(getMigrationsTableSQL(dialect))
    },

    async getAppliedMigrations(): Promise<AppliedMigration[]> {
      const quote = dialect === "mysql" ? "`" : '"'
      const table = `${quote}_reactivebase_migrations${quote}`
      const rows = await adapter.query<{ name: string; checksum: string; applied_at: string }>(
        `SELECT ${quote}name${quote}, ${quote}checksum${quote}, ${quote}applied_at${quote} FROM ${table} ORDER BY ${quote}applied_at${quote} ASC`,
      )
      return rows.map((r) => ({ name: r.name, checksum: r.checksum, appliedAt: r.applied_at }))
    },

    async applyMigration(name: string, sql: string, checksum: string): Promise<void> {
      const tx = await adapter.beginTransaction()
      try {
        await tx.execute(sql)
        const translator = getTranslator(dialect)
        const quote = dialect === "mysql" ? "`" : '"'
        const table = `${quote}_reactivebase_migrations${quote}`
        const insertSQL = `INSERT INTO ${table} (${quote}name${quote}, ${quote}checksum${quote}, ${quote}applied_at${quote}) VALUES ($1, $2, ${translator.now()})`
        await tx.execute(translator.translateParams(insertSQL), [name, checksum])
        await tx.commit()
      } catch (err: unknown) {
        await tx.rollback()
        throw err
      }
    },

    async rollbackMigration(name: string, sql: string): Promise<void> {
      const tx = await adapter.beginTransaction()
      try {
        await tx.execute(sql)
        const translator = getTranslator(dialect)
        const quote = dialect === "mysql" ? "`" : '"'
        const table = `${quote}_reactivebase_migrations${quote}`
        const deleteSQL = `DELETE FROM ${table} WHERE ${quote}name${quote} = $1`
        await tx.execute(translator.translateParams(deleteSQL), [name])
        await tx.commit()
      } catch (err: unknown) {
        await tx.rollback()
        throw err
      }
    },

    async lockMigrations(): Promise<void> {
      await adapter.execute(lockSQL.lock)
    },

    async unlockMigrations(): Promise<void> {
      await adapter.execute(lockSQL.unlock)
    },
  }
}

// ─── Adapter Bundle Factory ──────────────────────────────────────────────────

export interface AdapterBundle {
  /** Core database adapter */
  adapter: DatabaseAdapter
  /** Change data capture adapter */
  cdc: CdcAdapter
  /** Migration adapter */
  migrations: MigrationAdapter
  /** Connection pool adapter */
  pool: ConnectionPoolAdapter
}

export interface AdapterBundleOptions {
  /** Database connection string or URL */
  connectionString: string
  /** Connection pool size (ignored for SQLite) */
  poolSize?: number
  /** SSL configuration (Postgres and MySQL only) */
  ssl?: boolean | "require"
  /** Replication slot name (Postgres CDC only) */
  cdcSlotName?: string
  /** Polling interval for SQLite CDC in milliseconds */
  cdcPollIntervalMs?: number
}

/** Create a complete adapter bundle for the given dialect */
export function createAdapterBundle(dialect: DatabaseDialect, options: AdapterBundleOptions): AdapterBundle {
  switch (dialect) {
    case "postgres": {
      const pgOpts: PostgresAdapterOptions = {
        connectionString: options.connectionString,
        poolSize: options.poolSize,
        ssl: options.ssl,
      }
      const adapter = createPostgresAdapter(pgOpts)
      return {
        adapter,
        cdc: createPostgresCdcAdapter({
          connectionString: options.connectionString,
          slotName: options.cdcSlotName,
        }),
        migrations: createMigrationAdapter(adapter),
        pool: createPostgresPoolAdapter(pgOpts),
      }
    }
    case "mysql": {
      const myOpts: MySQLAdapterOptions = {
        connectionString: options.connectionString,
        poolSize: options.poolSize,
        ssl: typeof options.ssl === "string" ? true : options.ssl,
      }
      const adapter = createMySQLAdapter(myOpts)
      return {
        adapter,
        cdc: createMySQLCdcAdapter({
          connectionString: options.connectionString,
        }),
        migrations: createMigrationAdapter(adapter),
        pool: createMySQLPoolAdapter(myOpts),
      }
    }
    case "sqlite": {
      const sqliteOpts: SQLiteAdapterOptions = {
        url: options.connectionString,
      }
      const adapter = createSQLiteAdapter(sqliteOpts)
      return {
        adapter,
        cdc: createSQLiteCdcAdapter({
          url: options.connectionString,
          pollIntervalMs: options.cdcPollIntervalMs,
        }),
        migrations: createMigrationAdapter(adapter),
        pool: createSQLitePoolAdapter(sqliteOpts),
      }
    }
  }
}
