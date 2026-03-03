/**
 * Pinia adapter for @reactivebase/state.
 * Creates Pinia stores backed by ReactiveBase queries.
 *
 * Usage:
 *   import { defineReactiveStore } from "@reactivebase/state/adapters/pinia"
 *   const useTaskStore = defineReactiveStore("tasks", reactiveStore, { tasks: "tasks.list" })
 */

import type { ReactiveStore, QueryState } from "../index.js"

export interface PiniaStoreConfig {
  [key: string]: string | { queryName: string; args?: unknown }
}

/**
 * Define a Pinia-compatible store that syncs with ReactiveBase queries.
 * Returns a store definition object with reactive state and actions.
 */
export function defineReactiveStore<T extends PiniaStoreConfig>(
  storeId: string,
  store: ReactiveStore,
  queries: T,
): {
  id: string
  state: Record<string, QueryState>
  subscribe: (callback: (state: Record<string, QueryState>) => void) => () => void
  refresh: (key: string) => void
  destroy: () => void
} {
  const state: Record<string, QueryState> = {}
  const handles: Array<{ key: string; handle: ReturnType<typeof store.query> }> = []
  const listeners = new Set<(state: Record<string, QueryState>) => void>()

  for (const [key, queryConfig] of Object.entries(queries)) {
    const queryName = typeof queryConfig === "string" ? queryConfig : queryConfig.queryName
    const args = typeof queryConfig === "string" ? {} : (queryConfig.args ?? {})

    const handle = store.query(queryName, args)
    state[key] = handle.get()
    handles.push({ key, handle })

    handle.subscribe((queryState) => {
      state[key] = queryState
      for (const listener of listeners) {
        listener({ ...state })
      }
    })
  }

  return {
    id: storeId,
    state,
    subscribe: (callback) => {
      listeners.add(callback)
      callback({ ...state })
      return () => listeners.delete(callback)
    },
    refresh: (key: string) => {
      const entry = handles.find((h) => h.key === key)
      if (entry) entry.handle.refresh()
    },
    destroy: () => {
      for (const entry of handles) {
        entry.handle.destroy()
      }
      listeners.clear()
    },
  }
}
