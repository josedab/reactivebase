/**
 * React hooks for local-first data access.
 * Provides useLocalQuery and useLocalMutation for reading/writing
 * to the local SQLite-backed store with automatic re-renders.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useLocalQuery("tasks", { where: { done: 0 } })
 *   const { mutate, loading: saving } = useLocalMutation("tasks")
 *   await mutate("insert", { id: "t1", title: "Buy milk", done: 0 })
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useReactiveBaseClient } from "../provider/provider.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LocalQueryOptions {
  /** Whether the query is enabled (default: true). Set to false to defer execution. */
  enabled?: boolean
  /** Poll interval in ms for re-fetching local data (default: 0 = no polling) */
  pollIntervalMs?: number
}

export interface UseLocalQueryReturn<T> {
  /** Query results from the local store */
  data: T[] | undefined
  /** Whether the initial load is in progress */
  loading: boolean
  /** Error if the local query failed */
  error: Error | null
  /** Manually re-execute the query */
  refetch: () => void
}

export interface LocalQueryFilter {
  /** WHERE clause conditions as key-value pairs */
  where?: Record<string, unknown>
  /** ORDER BY columns */
  orderBy?: Array<{ column: string; direction?: "ASC" | "DESC" }>
  /** LIMIT */
  limit?: number
  /** OFFSET */
  offset?: number
}

export interface UseLocalMutationReturn {
  /** Execute a local mutation */
  mutate: (operation: "insert" | "update" | "delete", data: Record<string, unknown>) => Promise<string | undefined>
  /** Whether a mutation is in progress */
  loading: boolean
  /** Error if the last mutation failed */
  error: Error | null
}

// ─── useLocalQuery ───────────────────────────────────────────────────────────

/**
 * Read data from the local SQLite-backed store.
 * Re-renders when local data changes (via polling or manual refetch).
 *
 * Usage:
 *   const { data, loading, error, refetch } = useLocalQuery<Task>("tasks", {
 *     where: { done: 0 },
 *     orderBy: [{ column: "created_at", direction: "DESC" }],
 *     limit: 50,
 *   })
 *
 * With conditional execution:
 *   const { data } = useLocalQuery("tasks", undefined, { enabled: isReady })
 *
 * @param table - The local table name to query
 * @param query - Optional filter, ordering, and pagination
 * @param options - Query options (e.g., `enabled`, `pollIntervalMs`)
 * @returns A {@link UseLocalQueryReturn} with `data`, `loading`, `error`, and `refetch`
 */
export function useLocalQuery<T = Record<string, unknown>>(
  table: string,
  query?: LocalQueryFilter,
  options?: LocalQueryOptions,
): UseLocalQueryReturn<T> {
  const client = useReactiveBaseClient()
  const [data, setData] = useState<T[] | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const queryJson = JSON.stringify(query)
  const enabled = options?.enabled ?? true
  const pollIntervalMs = options?.pollIntervalMs ?? 0
  const refetchRef = useRef(0)

  const executeQuery = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await client.mutate("__local_query", { table, query })
      setData((result as { rows: T[] })?.rows ?? (result as T[]) ?? [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)))
      setData(undefined)
    } finally {
      setLoading(false)
    }
  }, [client, table, queryJson, enabled])

  const refetch = useCallback(() => {
    refetchRef.current += 1
    executeQuery()
  }, [executeQuery])

  // Initial fetch and re-fetch on query change
  useEffect(() => {
    executeQuery()
  }, [executeQuery])

  // Polling
  useEffect(() => {
    if (!enabled || pollIntervalMs <= 0) return

    const interval = setInterval(() => {
      executeQuery()
    }, pollIntervalMs)

    return () => clearInterval(interval)
  }, [enabled, pollIntervalMs, executeQuery])

  return { data, loading, error, refetch }
}

// ─── useLocalMutation ────────────────────────────────────────────────────────

/**
 * Write to the local SQLite-backed store.
 * Mutations are applied locally first (instant) and queued for server sync.
 *
 * Usage:
 *   const { mutate, loading, error } = useLocalMutation("tasks")
 *
 *   // Insert
 *   await mutate("insert", { id: "t1", title: "Buy milk", done: 0 })
 *
 *   // Update
 *   await mutate("update", { id: "t1", done: 1 })
 *
 *   // Delete
 *   await mutate("delete", { id: "t1" })
 *
 * @param table - The local table name to mutate
 * @returns A {@link UseLocalMutationReturn} with `mutate`, `loading`, and `error`
 */
export function useLocalMutation(table: string): UseLocalMutationReturn {
  const client = useReactiveBaseClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const mutate = useCallback(
    async (
      operation: "insert" | "update" | "delete",
      data: Record<string, unknown>,
    ): Promise<string | undefined> => {
      setLoading(true)
      setError(null)

      try {
        const result = await client.mutate("__local_mutation", {
          table,
          operation,
          data,
        })
        return result as string | undefined
      } catch (err: unknown) {
        const mutationError = err instanceof Error ? err : new Error(String(err))
        setError(mutationError)
        throw mutationError
      } finally {
        setLoading(false)
      }
    },
    [client, table],
  )

  return { mutate, loading, error }
}
