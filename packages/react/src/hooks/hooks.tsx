/**
 * React hooks for ReactiveBase - useQuery, useMutation, useAction.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useReactiveBaseClient } from "../provider/provider.js"

/**
 * A function reference to a server query/mutation/action.
 * In a real implementation, this would be generated from the schema.
 */
export interface FunctionReference<_TArgs = unknown, _TReturn = unknown> {
  _name: string
  _type: "query" | "mutation" | "action"
  /** Phantom types for inference — do not use at runtime */
  _args?: _TArgs
  _return?: _TReturn
}

export interface OptimisticUpdateConfig<TArgs = unknown> {
  optimisticUpdate?: (localStore: LocalStore, args: TArgs) => void
}

export interface LocalStore {
  /** Update a specific query's cached data */
  updateQuery(queryName: string, updater: (data: unknown, args: unknown) => unknown): void
  /** Update a specific subscription by ID */
  update(subscriptionId: string, updater: (data: unknown) => unknown): void
}

export interface UseQueryOptions {
  /** Whether the query is enabled (default: true). Set to false to defer execution. */
  enabled?: boolean
}

/**
 * Subscribe to a reactive query. Returns `undefined` during loading,
 * then the typed result. Re-renders when server pushes updates.
 *
 * When used with a typed FunctionReference, TResult is inferred automatically:
 *   const tasks = useQuery(api.tasks.listTasks, { userId: "u1" })
 *   // tasks is Task[] | undefined
 *
 * Dependent query pattern:
 *   const user = useQuery(api.users.get, { id: userId })
 *   const tasks = useQuery(api.tasks.listByUser, { userId: user?.id }, { enabled: !!user })
 *
 * @param queryRef - A typed {@link FunctionReference} or query name string
 * @param args - Arguments to pass to the query function
 * @param options - Query options (e.g., `enabled` to defer execution)
 * @returns The query result, or `undefined` while loading. Throws on error.
 */
export function useQuery<TResult = unknown, TArgs = unknown>(
  queryRef: FunctionReference<TArgs, TResult> | string,
  args?: TArgs,
  options?: UseQueryOptions,
): TResult | undefined {
  const client = useReactiveBaseClient()
  const [data, setData] = useState<TResult | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  const queryName = typeof queryRef === "string" ? queryRef : queryRef._name
  const argsRef = useRef(args)
  const argsJson = JSON.stringify(args)
  const enabled = options?.enabled ?? true

  useEffect(() => {
    argsRef.current = args
  }, [argsJson])

  useEffect(() => {
    if (!enabled) {
      return
    }

    setData(undefined)
    setError(null)

    const unsubscribe = client.subscribe(queryName, argsRef.current, (result, err) => {
      if (err) {
        setError(err)
      } else {
        setData(result as TResult)
      }
    })

    return unsubscribe
  }, [client, queryName, argsJson, enabled])

  if (error) throw error

  return data
}

/**
 * Returns a function that calls a server mutation.
 * Supports optimistic updates with automatic rollback on failure.
 *
 * @param mutationRef - A typed {@link FunctionReference} or mutation name string
 * @param config - Optional config with an `optimisticUpdate` callback for local cache updates
 * @returns An async function that accepts mutation arguments and returns the server result
 */
export function useMutation<TArgs = unknown, TResult = unknown>(
  mutationRef: FunctionReference<TArgs, TResult> | string,
  config?: OptimisticUpdateConfig<TArgs>,
): (args: TArgs) => Promise<TResult> {
  const client = useReactiveBaseClient()
  const mutationName = typeof mutationRef === "string" ? mutationRef : mutationRef._name

  return useCallback(
    async (args: TArgs): Promise<TResult> => {
      const rollbacks: (() => void)[] = []

      // Apply optimistic update if configured
      if (config?.optimisticUpdate) {
        const cache = client.getCache()
        const localStore: LocalStore = {
          updateQuery(queryName, updater) {
            const rollback = cache.applyOptimisticUpdateByQuery(queryName, updater)
            rollbacks.push(rollback)
          },
          update(subscriptionId, updater) {
            const rollback = cache.applyOptimisticUpdate(subscriptionId, updater)
            rollbacks.push(rollback)
          },
        }
        config.optimisticUpdate(localStore, args)
      }

      try {
        const result = await client.mutate(mutationName, args)
        return result as TResult
      } catch (error: unknown) {
        // Rollback all optimistic updates on failure
        for (const rollback of rollbacks) {
          rollback()
        }
        throw error
      }
    },
    [client, mutationName, config],
  )
}

/**
 * Returns a function that triggers a background action.
 *
 * @param actionRef - A typed {@link FunctionReference} or action name string
 * @returns An async function that accepts action arguments and returns the server result
 */
export function useAction<TArgs = unknown, TResult = unknown>(
  actionRef: FunctionReference<TArgs, TResult> | string,
): (args: TArgs) => Promise<TResult> {
  const client = useReactiveBaseClient()
  const actionName = typeof actionRef === "string" ? actionRef : actionRef._name

  return useCallback(
    async (args: TArgs): Promise<TResult> => {
      const result = await client.runAction(actionName, args)
      return result as TResult
    },
    [client, actionName],
  )
}

// ─── Aggregate Query Hook ────────────────────────────────────────────────────

export interface AggregateQueryOptions {
  /** Whether the query is enabled (default: true). Set to false to defer execution. */
  enabled?: boolean
}

export interface AggregateQueryResult<T = unknown> {
  data: T | undefined
  isLoading: boolean
  error: Error | null
}

/**
 * Subscribe to a reactive aggregate query.
 * Returns aggregated results that update automatically when underlying data changes.
 *
 * Usage:
 *   const { data, isLoading } = useAggregateQuery(api.tasks.taskStats, { userId: "u1" })
 *
 * @param queryRef - A typed {@link FunctionReference} or query name string
 * @param args - Arguments to pass to the aggregate query
 * @param options - Query options (e.g., `enabled` to defer execution)
 * @returns An {@link AggregateQueryResult} with `data`, `isLoading`, and `error` fields
 */
export function useAggregateQuery<TResult = unknown, TArgs = unknown>(
  queryRef: FunctionReference<TArgs, TResult> | string,
  args?: TArgs,
  options?: AggregateQueryOptions,
): AggregateQueryResult<TResult> {
  const client = useReactiveBaseClient()
  const [data, setData] = useState<TResult | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const queryName = typeof queryRef === "string" ? queryRef : queryRef._name
  const argsRef = useRef(args)
  const argsJson = JSON.stringify(args)
  const enabled = options?.enabled ?? true

  useEffect(() => {
    argsRef.current = args
  }, [argsJson])

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }

    setData(undefined)
    setError(null)
    setIsLoading(true)

    const unsubscribe = client.subscribe(queryName, argsRef.current, (result, err) => {
      setIsLoading(false)
      if (err) {
        setError(err)
      } else {
        setData(result as TResult)
      }
    })

    return unsubscribe
  }, [client, queryName, argsJson, enabled])

  return { data, isLoading, error }
}
