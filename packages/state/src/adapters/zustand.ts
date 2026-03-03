/**
 * Zustand adapter for @reactivebase/state.
 * Syncs ReactiveBase queries with Zustand stores.
 *
 * Usage:
 *   import { createReactiveSlice } from "@reactivebase/state/adapters/zustand"
 *   const useStore = create(createReactiveSlice(reactiveStore, { tasks: "tasks.list" }))
 */

import type { ReactiveStore, QueryState } from "../index.js"

export interface ZustandSliceConfig {
  [key: string]: string | { queryName: string; args?: unknown }
}

/**
 * Create a Zustand store slice that syncs with ReactiveBase queries.
 * Each key maps to a query that auto-subscribes.
 */
export function createReactiveSlice<T extends ZustandSliceConfig>(
  store: ReactiveStore,
  config: T,
): (set: (fn: (state: Record<string, unknown>) => Record<string, unknown>) => void) => Record<string, QueryState> {
  return (set) => {
    const initialState: Record<string, QueryState> = {}

    for (const [key, queryConfig] of Object.entries(config)) {
      const queryName = typeof queryConfig === "string" ? queryConfig : queryConfig.queryName
      const args = typeof queryConfig === "string" ? {} : (queryConfig.args ?? {})

      const handle = store.query(queryName, args)
      initialState[key] = handle.get()

      handle.subscribe((state) => {
        set((prev) => ({ ...prev, [key]: state }))
      })
    }

    return initialState
  }
}

/**
 * Create a Zustand middleware that connects to ReactiveBase.
 */
export function reactiveBaseMiddleware(
  store: ReactiveStore,
  queries: Record<string, string | { queryName: string; args?: unknown }>,
) {
  return (config: (set: unknown, get: unknown, api: unknown) => Record<string, unknown>) =>
    (
      set: (fn: (state: Record<string, unknown>) => Record<string, unknown>) => void,
      get: () => Record<string, unknown>,
      api: unknown,
    ) => {
      const result = config(set, get, api)

      for (const [key, queryConfig] of Object.entries(queries)) {
        const queryName = typeof queryConfig === "string" ? queryConfig : queryConfig.queryName
        const args = typeof queryConfig === "string" ? {} : (queryConfig.args ?? {})

        const handle = store.query(queryName, args)
        handle.subscribe((state) => {
          set((prev) => ({ ...prev, [key]: state.data }))
        })
      }

      return result
    }
}
