/**
 * Client-side query composition hooks.
 *
 * Provides useDerivedQuery-style APIs for composing reactive queries
 * in framework-agnostic fashion. Framework-specific adapters (React/Vue/Svelte)
 * wrap these primitives.
 */

import type { ReactiveBaseClient, QueryListener } from "../subscription/index.js"

export interface DerivedSubscriptionHandle {
  readonly id: string
  readonly sourceIds: string[]
  unsubscribe: () => void
}

export interface ComposedQueryOptions {
  /** Debounce recomputation when multiple sources update simultaneously */
  debounceMs?: number
}

/**
 * Subscribe to a derived query that combines multiple source subscriptions.
 * When any source updates, the combiner re-runs and the listener receives the new value.
 */
export function subscribeDerived<T>(
  client: ReactiveBaseClient,
  sources: Array<{ queryName: string; args: unknown }>,
  combiner: (...values: unknown[]) => T,
  listener: QueryListener,
  options: ComposedQueryOptions = {},
): DerivedSubscriptionHandle {
  const sourceValues: (unknown | undefined)[] = new Array(sources.length).fill(undefined)
  const unsubscribeFns: Array<() => void> = []
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const recompute = () => {
    const allReady = sourceValues.every((v) => v !== undefined)
    if (!allReady) return

    try {
      const result = combiner(...sourceValues)
      listener(result)
    } catch (error: unknown) {
      listener(undefined, error instanceof Error ? error : new Error(String(error)))
    }
  }

  const debouncedRecompute = () => {
    if (options.debounceMs && options.debounceMs > 0) {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(recompute, options.debounceMs)
    } else {
      recompute()
    }
  }

  const sourceIds: string[] = []

  for (let i = 0; i < sources.length; i++) {
    const index = i
    const source = sources[i]
    const unsub = client.subscribe(source.queryName, source.args, (data, error) => {
      if (error) {
        listener(undefined, error)
        return
      }
      sourceValues[index] = data
      debouncedRecompute()
    })
    unsubscribeFns.push(unsub)
    sourceIds.push(`${source.queryName}:${index}`)
  }

  return {
    id: `derived_${sourceIds.join("+")}`,
    sourceIds,
    unsubscribe: () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      for (const unsub of unsubscribeFns) {
        unsub()
      }
    },
  }
}

/**
 * Subscribe to a transformed view of a single source query.
 */
export function subscribeTransformed<TIn, TOut>(
  client: ReactiveBaseClient,
  queryName: string,
  args: unknown,
  transform: (value: TIn) => TOut,
  listener: QueryListener,
): DerivedSubscriptionHandle {
  return subscribeDerived(
    client,
    [{ queryName, args }],
    (value) => transform(value as TIn),
    listener,
  )
}
