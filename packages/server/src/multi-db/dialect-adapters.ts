/**
 * Dialect-specific database adapter factory functions.
 */

import type {
  DatabaseAdapter,
  DatabaseAdapterInfo,
  TransactionHandle,
  PostgresAdapterOptions,
  SQLiteAdapterOptions,
  MySQLAdapterOptions,
  ConnectionPoolAdapter,
  PooledConnection,
  CdcAdapter,
  CdcPosition,
  CdcChangeCallback,
  PostgresCdcOptions,
  MySQLCdcOptions,
  SQLiteCdcOptions,
  createStubTransaction as CreateStubTransactionType,
} from "./adapter-types.js"
import { createStubTransaction, createStubPooledConnection } from "./adapter-types.js"
import { sqliteTranslator, mysqlTranslator } from "./dialect-translators.js"

// ─── Adapter Factories ───────────────────────────────────────────────────────

export function createPostgresAdapter(options: PostgresAdapterOptions): DatabaseAdapter {
  return {
    name: "postgres",
    dialect: "postgres",

    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
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

// ─── Pool Adapter Factories ──────────────────────────────────────────────────

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
      return createStubPooledConnection("postgres")
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

// ─── CDC Adapter Factories ───────────────────────────────────────────────────

/** Create a Postgres CDC adapter using logical replication (pgoutput) */
export function createPostgresCdcAdapter(options: PostgresCdcOptions): CdcAdapter {
  let listening = false
  const currentLsn = "0/0"
  void options

  return {
    async startListening(tables: string[], callback: CdcChangeCallback): Promise<void> {
      listening = true
      void tables
      void callback
    },

    async stopListening(): Promise<void> {
      listening = false
    },

    async getPosition(): Promise<CdcPosition> {
      void listening
      return { type: "lsn", lsn: currentLsn }
    },
  }
}

/** Create a MySQL CDC adapter using binlog replication */
export function createMySQLCdcAdapter(options: MySQLCdcOptions): CdcAdapter {
  let listening = false
  const currentFile = "mysql-bin.000001"
  const currentPosition = 4
  void options

  return {
    async startListening(tables: string[], callback: CdcChangeCallback): Promise<void> {
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

/** Create a SQLite CDC adapter using polling-based change detection */
export function createSQLiteCdcAdapter(options: SQLiteCdcOptions): CdcAdapter {
  let listening = false
  const currentOffset = 0
  let pollTimer: ReturnType<typeof setInterval> | undefined
  void options

  return {
    async startListening(tables: string[], callback: CdcChangeCallback): Promise<void> {
      listening = true
      const interval = options.pollIntervalMs ?? 1000
      pollTimer = setInterval(() => {
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
