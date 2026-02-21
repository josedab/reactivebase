/**
 * Transaction manager - wraps mutations in serializable Postgres transactions
 * with automatic retry on serialization failures (error code 40001).
 */

import type { Pool, PoolClient } from "pg"

export interface TransactionOptions {
  maxRetries: number
  isolationLevel: "SERIALIZABLE" | "READ COMMITTED" | "REPEATABLE READ"
}

const DEFAULT_OPTIONS: TransactionOptions = {
  maxRetries: 3,
  isolationLevel: "SERIALIZABLE",
}

export interface TransactionResult<T> {
  result: T
  retries: number
  tablesModified: Set<string>
}

/**
 * Execute a function within a serializable Postgres transaction.
 * Automatically retries on serialization failures (40001).
 */
export async function executeTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
  options: Partial<TransactionOptions> = {},
): Promise<TransactionResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let retries = 0

  while (true) {
    const client = await pool.connect()

    try {
      await client.query(`BEGIN ISOLATION LEVEL ${opts.isolationLevel}`)
      const result = await fn(client)
      await client.query("COMMIT")

      return {
        result,
        retries,
        tablesModified: new Set(),
      }
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => {})

      const pgError = error as { code?: string }
      if (pgError.code === "40001" && retries < opts.maxRetries) {
        retries++
        continue
      }

      throw error
    } finally {
      client.release()
    }
  }
}

/**
 * Execute a read-only query with READ COMMITTED isolation.
 */
export async function executeReadOnly<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()

  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
