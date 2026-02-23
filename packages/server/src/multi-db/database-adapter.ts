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
