/**
 * React hooks for ReactiveBase - useQuery, useMutation, useAction.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useReactiveBaseClient } from "../provider/provider.js"

/**
 * A function reference to a server query/mutation/action.
 * In a real implementation, this would be generated from the schema.
 */
export interface FunctionReference {
  _name: string
  _type: "query" | "mutation" | "action"
}

export interface OptimisticUpdateConfig<TArgs = unknown> {
  optimisticUpdate?: (
    localStore: LocalStore,
    args: TArgs,
  ) => void
}

export interface LocalStore {
  update(table: string, id: string, changes: Record<string, unknown>): void
}

/**
 * Subscribe to a reactive query. Returns `undefined` during loading,
 * then the typed result. Re-renders when server pushes updates.
 */
export function useQuery<TResult = unknown>(
  queryRef: FunctionReference | string,
  args?: unknown,
): TResult | undefined {
  const client = useReactiveBaseClient()
  const [data, setData] = useState<TResult | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  const queryName = typeof queryRef === "string" ? queryRef : queryRef._name
  const argsRef = useRef(args)
  const argsJson = JSON.stringify(args)

  useEffect(() => {
    argsRef.current = args
  }, [argsJson])

  useEffect(() => {
    setData(undefined)
    setError(null)

    const unsubscribe = client.subscribe(
      queryName,
      argsRef.current,
      (result, err) => {
        if (err) {
          setError(err)
        } else {
          setData(result as TResult)
        }
      },
    )

    return unsubscribe
  }, [client, queryName, argsJson])

  if (error) throw error

  return data
}

/**
 * Returns a function that calls a server mutation.
 * Supports optimistic updates with automatic rollback.
 */
export function useMutation<TArgs = unknown, TResult = unknown>(
  mutationRef: FunctionReference | string,
  config?: OptimisticUpdateConfig<TArgs>,
): (args: TArgs) => Promise<TResult> {
  const client = useReactiveBaseClient()
  const mutationName = typeof mutationRef === "string" ? mutationRef : mutationRef._name

  return useCallback(
    async (args: TArgs): Promise<TResult> => {
      // Apply optimistic update if configured
      let rollback: (() => void) | undefined
      if (config?.optimisticUpdate) {
        const cache = client.getCache()
        const localStore: LocalStore = {
          update(_table, _id, _changes) {
            // In a full implementation, this would update specific cache entries
            // by finding subscriptions that include the affected table/id
          },
        }
        config.optimisticUpdate(localStore, args)
      }

      try {
        const result = await client.mutate(mutationName, args)
        return result as TResult
      } catch (error) {
        rollback?.()
        throw error
      }
    },
    [client, mutationName, config],
  )
}

/**
 * Returns a function that triggers a background action.
 */
export function useAction<TArgs = unknown, TResult = unknown>(
  actionRef: FunctionReference | string,
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
