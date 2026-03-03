/**
 * Jotai adapter for @reactivebase/state.
 * Creates Jotai atoms backed by ReactiveBase queries.
 *
 * Usage:
 *   import { queryAtom, mutationAtom } from "@reactivebase/state/adapters/jotai"
 *   const tasksAtom = queryAtom(reactiveStore, "tasks.list")
 */

import type { ReactiveStore, QueryState, MutationState } from "../index.js"

/**
 * Create a Jotai-compatible atom backed by a ReactiveBase query.
 * Returns an atom factory that provides { data, error, isLoading, isLive }.
 */
export function queryAtom<T = unknown>(
  store: ReactiveStore,
  queryName: string,
  args: unknown = {},
): {
  get: () => QueryState<T>
  subscribe: (callback: (state: QueryState<T>) => void) => () => void
} {
  const handle = store.query<T>(queryName, args)

  return {
    get: () => handle.get(),
    subscribe: (callback) => handle.subscribe(callback),
  }
}

/**
 * Create a derived Jotai atom from a reactive query with a selector.
 */
export function selectorAtom<T, R>(
  store: ReactiveStore,
  queryName: string,
  args: unknown,
  selector: (data: T) => R,
): {
  get: () => R | undefined
  subscribe: (callback: (value: R | undefined) => void) => () => void
} {
  const handle = store.query<T>(queryName, args)
  const derived = store.select(handle, selector)

  return {
    get: () => derived.get(),
    subscribe: (callback) => derived.subscribe(callback),
  }
}

/**
 * Create a Jotai-compatible mutation atom.
 */
export function mutationAtom<TArgs = unknown, TResult = unknown>(
  store: ReactiveStore,
  mutationName: string,
): {
  execute: (args: TArgs) => Promise<TResult>
  get: () => MutationState<TResult>
  subscribe: (callback: (state: MutationState<TResult>) => void) => () => void
} {
  const handle = store.mutation<TArgs, TResult>(mutationName)

  return {
    execute: (args) => handle.execute(args),
    get: () => handle.get(),
    subscribe: (callback) => handle.subscribe(callback),
  }
}
