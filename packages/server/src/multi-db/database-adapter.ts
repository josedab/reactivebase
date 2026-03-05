/**
 * Multi-Database Adapter Layer for ReactiveBase.
 *
 * This module re-exports from focused sub-modules:
 *   - adapter-types.ts       — Core interfaces, types, error class, stub helpers
 *   - dialect-translators.ts — SQL dialect translators and DDL translation
 *   - dialect-adapters.ts    — Adapter, pool, and CDC factory functions per dialect
 *   - migration-adapter.ts   — Migration adapter and bundle factory
 */

// ─── Types and helpers ──────────────────────────────────────────────────────
export { DatabaseAdapterError, createStubTransaction, createStubPooledConnection } from "./adapter-types.js"
export type {
  DatabaseAdapter,
  DatabaseDialect,
  TransactionHandle,
  DatabaseAdapterInfo,
  SQLTranslator,
  PostgresAdapterOptions,
  SQLiteAdapterOptions,
  MySQLAdapterOptions,
  ConnectionPoolAdapter,
  PooledConnection,
  CdcChangeEvent,
  CdcPosition,
  CdcChangeCallback,
  CdcAdapter,
  PostgresCdcOptions,
  MySQLCdcOptions,
  SQLiteCdcOptions,
  AppliedMigration,
  MigrationAdapter,
  AdapterBundle,
  AdapterBundleOptions,
} from "./adapter-types.js"

// ─── SQL dialect translators ────────────────────────────────────────────────
export {
  postgresTranslator,
  sqliteTranslator,
  mysqlTranslator,
  getTranslator,
  translateColumnType,
  translateCreateTable,
} from "./dialect-translators.js"

// ─── Dialect adapter factories ──────────────────────────────────────────────
export {
  createPostgresAdapter,
  createSQLiteAdapter,
  createMySQLAdapter,
  createPostgresPoolAdapter,
  createSQLitePoolAdapter,
  createMySQLPoolAdapter,
  createPostgresCdcAdapter,
  createMySQLCdcAdapter,
  createSQLiteCdcAdapter,
} from "./dialect-adapters.js"

// ─── Migrations and bundle ──────────────────────────────────────────────────
export {
  getMigrationsTableSQL,
  getMigrationLockSQL,
  createMigrationAdapter,
  createAdapterBundle,
} from "./migration-adapter.js"
