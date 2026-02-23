/**
 * Database migration workflow for ReactiveBase.
 * Tracks applied migrations, generates diffs, and supports rollback.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises"
import { join, basename } from "node:path"
import { existsSync } from "node:fs"
import type { Schema } from "../schema/index.js"
import { generateMigrationSQL } from "../schema/index.js"

export interface MigrationRecord {
  version: string
  name: string
  appliedAt: string
}

export interface MigrationFile {
  version: string
  name: string
  upSQL: string
  downSQL: string
  filePath: string
}

/**
 * Migration manager — handles the full lifecycle of database migrations.
 */
export class MigrationManager {
  constructor(
    private migrationsDir: string,
    private queryFn?: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>,
  ) {}

  /**
   * Generate a new migration from the current schema.
   */
  async generate(schema: Schema, name: string = "migration"): Promise<MigrationFile> {
    await mkdir(this.migrationsDir, { recursive: true })

    const timestamp = Date.now()
    const version = String(timestamp)
    const fileName = `${version}_${sanitizeName(name)}`

    const migration = generateMigrationSQL(schema)

    const upPath = join(this.migrationsDir, `${fileName}.up.sql`)
    const downPath = join(this.migrationsDir, `${fileName}.down.sql`)

    await writeFile(upPath, migration.up, "utf-8")
    await writeFile(downPath, migration.down, "utf-8")

    return {
      version,
      name,
      upSQL: migration.up,
      downSQL: migration.down,
      filePath: upPath,
    }
  }

  /**
   * Get all migration files from the migrations directory.
   */
  async getMigrationFiles(): Promise<MigrationFile[]> {
    if (!existsSync(this.migrationsDir)) return []

    const files = await readdir(this.migrationsDir)
    const upFiles = files.filter((f) => f.endsWith(".up.sql")).sort()

    const migrations: MigrationFile[] = []

    for (const upFile of upFiles) {
      const match = upFile.match(/^(\d+)_(.+)\.up\.sql$/)
      if (!match) continue

      const [, version, name] = match
      const downFile = upFile.replace(".up.sql", ".down.sql")

      const upSQL = await readFile(join(this.migrationsDir, upFile), "utf-8")
      const downSQL = existsSync(join(this.migrationsDir, downFile))
        ? await readFile(join(this.migrationsDir, downFile), "utf-8")
        : ""

      migrations.push({
        version,
        name,
        upSQL,
        downSQL,
        filePath: join(this.migrationsDir, upFile),
      })
    }

    return migrations
  }

  /**
   * Get applied migrations from the database.
   */
  async getApplied(): Promise<MigrationRecord[]> {
    if (!this.queryFn) return []

    try {
      await this.queryFn(`
        CREATE TABLE IF NOT EXISTS "_reactivebase_migrations" (
          version text PRIMARY KEY,
          name text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `)

      const result = await this.queryFn(
        `SELECT version, name, applied_at as "appliedAt" FROM "_reactivebase_migrations" ORDER BY version ASC`,
      )

      return result.rows as MigrationRecord[]
    } catch {
      return []
    }
  }

  /**
   * Get pending (unapplied) migrations.
   */
  async getPending(): Promise<MigrationFile[]> {
    const files = await this.getMigrationFiles()
    const applied = await this.getApplied()
    const appliedVersions = new Set(applied.map((m) => m.version))

    return files.filter((f) => !appliedVersions.has(f.version))
  }

  /**
   * Apply all pending migrations.
   */
  async apply(): Promise<ApplyResult> {
    if (!this.queryFn) throw new Error("Database connection required for apply")

    const pending = await this.getPending()
    const applied: string[] = []

    for (const migration of pending) {
      try {
        await this.queryFn(migration.upSQL)
        await this.queryFn(`INSERT INTO "_reactivebase_migrations" (version, name) VALUES ($1, $2)`, [
          migration.version,
          migration.name,
        ])
        applied.push(migration.version)
      } catch (error) {
        return {
          applied,
          failed: migration.version,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    return { applied, total: pending.length }
  }

  /**
   * Rollback the last applied migration.
   */
  async rollback(): Promise<RollbackResult> {
    if (!this.queryFn) throw new Error("Database connection required for rollback")

    const applied = await this.getApplied()
    if (applied.length === 0) {
      return { rolledBack: null, message: "No migrations to rollback" }
    }

    const lastApplied = applied[applied.length - 1]
    const files = await this.getMigrationFiles()
    const migrationFile = files.find((f) => f.version === lastApplied.version)

    if (!migrationFile) {
      return {
        rolledBack: null,
        message: `Migration file not found for version ${lastApplied.version}`,
      }
    }

    if (!migrationFile.downSQL) {
      return {
        rolledBack: null,
        message: `No down migration for version ${lastApplied.version}`,
      }
    }

    await this.queryFn(migrationFile.downSQL)
    await this.queryFn(`DELETE FROM "_reactivebase_migrations" WHERE version = $1`, [lastApplied.version])

    return { rolledBack: lastApplied.version }
  }

  /**
   * Get migration status.
   */
  async status(): Promise<MigrationStatus> {
    const files = await this.getMigrationFiles()
    const applied = await this.getApplied()
    const pending = await this.getPending()

    return {
      total: files.length,
      applied: applied.length,
      pending: pending.length,
      lastApplied: applied.length > 0 ? applied[applied.length - 1] : null,
      migrations: files.map((f) => ({
        version: f.version,
        name: f.name,
        status: applied.some((a) => a.version === f.version) ? ("applied" as const) : ("pending" as const),
      })),
    }
  }
}

export interface ApplyResult {
  applied: string[]
  total?: number
  failed?: string
  error?: string
}

export interface RollbackResult {
  rolledBack: string | null
  message?: string
}

export interface MigrationStatus {
  total: number
  applied: number
  pending: number
  lastApplied: MigrationRecord | null
  migrations: Array<{
    version: string
    name: string
    status: "applied" | "pending"
  }>
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
}
