/**
 * Nanostores adapter for @reactivebase/state.
 * Creates Nanostores-compatible atoms backed by ReactiveBase queries.
 *
 * Usage:
 *   import { reactiveAtom } from "@reactivebase/state/adapters/nanostores"
 *   const $tasks = reactiveAtom(reactiveStore, "tasks.list")
 *   $tasks.subscribe((state) => console.log(state.data))
 */

import type { ReactiveStore, QueryState } from "../index.js"

export interface NanoAtom<T> {
  get: () => QueryState<T>
  subscribe: (callback: (state: QueryState<T>) => void) => () => void
  destroy: () => void
}

/**
 * Create a Nanostores-compatible reactive atom from a ReactiveBase query.
 */
export function reactiveAtom<T = unknown>(store: ReactiveStore, queryName: string, args: unknown = {}): NanoAtom<T> {
  const handle = store.query<T>(queryName, args)

  return {
    get: () => handle.get(),
    subscribe: (callback) => handle.subscribe(callback),
    destroy: () => handle.destroy(),
  }
}

/**
 * Create a computed Nanostores atom from a reactive atom with a selector.
 */
export function computedAtom<T, R>(
  store: ReactiveStore,
  queryName: string,
  args: unknown,
  selector: (data: T) => R,
): {
  get: () => R | undefined
  subscribe: (callback: (value: R | undefined) => void) => () => void
  destroy: () => void
} {
  const handle = store.query<T>(queryName, args)
  const derived = store.select(handle, selector)

  return {
    get: () => derived.get(),
    subscribe: (callback) => derived.subscribe(callback),
    destroy: () => derived.destroy(),
  }
}
