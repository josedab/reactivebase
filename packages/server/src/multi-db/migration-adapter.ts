/**
 * Migration adapter and bundle factory for the multi-database layer.
 */

import type {
  DatabaseAdapter,
  DatabaseDialect,
  AppliedMigration,
  MigrationAdapter,
  AdapterBundle,
  AdapterBundleOptions,
  PostgresAdapterOptions,
  MySQLAdapterOptions,
  SQLiteAdapterOptions,
} from "./adapter-types.js"
import { getTranslator } from "./dialect-translators.js"
import {
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
