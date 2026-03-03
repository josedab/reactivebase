/**
 * ReactiveBase Svelte stores.
 * Implements the Svelte store contract (subscribe method) backed by
 * ReactiveBase client subscriptions for seamless reactive data binding.
 */

import {
  ReactiveBaseClient,
  type ReactiveBaseClientOptions,
  type ClientSubscriptionMiddleware,
} from "@reactivebase/client"

// --- Client management ---

let globalClient: ReactiveBaseClient | null = null

export interface ReactiveBaseSvelteOptions extends ReactiveBaseClientOptions {
  /** Client-side subscription middleware pipeline */
  middleware?: ClientSubscriptionMiddleware[]
}

/**
 * Initialize the ReactiveBase client for Svelte.
 * Call once at app startup.
 */
export function initReactiveBase(options: ReactiveBaseSvelteOptions): ReactiveBaseClient {
  globalClient = new ReactiveBaseClient(options)
  return globalClient
}

/**
 * Get the current client instance.
 */
export function getReactiveBaseClient(): ReactiveBaseClient {
  if (!globalClient) {
    throw new Error("ReactiveBase not initialized. Call initReactiveBase() first.")
  }
  return globalClient
}

/**
 * Disconnect and clean up the client.
 */
export function destroyReactiveBase(): void {
  globalClient?.disconnect()
  globalClient = null
}

// --- Store types ---

export interface FunctionReference {
  _name: string
  _type: "query" | "mutation" | "action"
}

/** Svelte store contract */
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void
}

export interface QueryStoreValue<T> {
  data: T | undefined
  error: Error | null
  isLoading: boolean
}

// --- Query Store ---

/**
 * Create a Svelte readable store backed by a ReactiveBase query subscription.
 * The store updates automatically when the server pushes new data.
 *
 * Usage:
 *   const tasks = queryStore("listTasks", { userId: "u1" })
 *   $tasks.data  // reactive data
 */
export function queryStore<T = unknown>(
  queryRef: FunctionReference | string,
  args?: unknown,
): Readable<QueryStoreValue<T>> {
  const queryName = typeof queryRef === "string" ? queryRef : queryRef._name

  return {
    subscribe(run: (value: QueryStoreValue<T>) => void): () => void {
      const client = getReactiveBaseClient()

      let current: QueryStoreValue<T> = {
        data: undefined,
        error: null,
        isLoading: true,
      }
      run(current)

      const unsubscribe = client.subscribe(queryName, args, (result, error) => {
        current = {
          data: error ? current.data : (result as T),
          error: error ?? null,
          isLoading: false,
        }
        run(current)
      })

      return unsubscribe
    },
  }
}

// --- Mutation helper ---

export interface MutationHandle<TArgs, TResult> {
  mutate: (args: TArgs) => Promise<TResult>
}

/**
 * Create a mutation caller.
 *
 * Usage:
 *   const { mutate } = createMutation("completeTask")
 *   await mutate({ taskId: "123" })
 */
export function createMutation<TArgs = unknown, TResult = unknown>(
  mutationRef: FunctionReference | string,
): MutationHandle<TArgs, TResult> {
  const mutationName = typeof mutationRef === "string" ? mutationRef : mutationRef._name

  return {
    async mutate(args: TArgs): Promise<TResult> {
      const client = getReactiveBaseClient()
      return (await client.mutate(mutationName, args)) as TResult
    },
  }
}

// --- Action helper ---

export interface ActionHandle<TArgs, TResult> {
  run: (args: TArgs) => Promise<TResult>
}

/**
 * Create an action caller.
 *
 * Usage:
 *   const { run } = createAction("sendEmail")
 *   await run({ userId: "123" })
 */
export function createAction<TArgs = unknown, TResult = unknown>(
  actionRef: FunctionReference | string,
): ActionHandle<TArgs, TResult> {
  const actionName = typeof actionRef === "string" ? actionRef : actionRef._name

  return {
    async run(args: TArgs): Promise<TResult> {
      const client = getReactiveBaseClient()
      return (await client.runAction(actionName, args)) as TResult
    },
  }
}

// Pre-built reactive UI stores
export { reactiveTableStore, reactiveFormStore, presenceAvatarsStore } from "./components.js"
export type {
  SvelteTableColumn,
  ReactiveTableStoreOptions,
  ReactiveTableState,
  ReactiveTableStore,
  SvelteFormField,
  ReactiveFormStoreOptions,
  ReactiveFormState,
  ReactiveFormStore,
  SveltePresenceUser,
  PresenceAvatarsStoreOptions,
  PresenceAvatarsState,
} from "./components.js"

// ─── Local-First Stores ──────────────────────────────────────────────────────

export interface LocalQueryFilter {
  where?: Record<string, unknown>
  orderBy?: Array<{ column: string; direction?: "ASC" | "DESC" }>
  limit?: number
  offset?: number
}

export interface LocalQueryStoreValue<T> {
  data: T[] | undefined
  loading: boolean
  error: Error | null
}

/**
 * Create a Svelte readable store for local-first SQLite queries.
 * Data comes from the local store instantly, with background sync to server.
 *
 * Usage:
 *   const tasks = localQueryStore<Task>("tasks", { where: { done: 0 } })
 *   $tasks.data  // reactive local data
 */
export function localQueryStore<T = Record<string, unknown>>(
  table: string,
  query?: LocalQueryFilter,
  options?: { pollIntervalMs?: number },
): Readable<LocalQueryStoreValue<T>> {
  return {
    subscribe(run: (value: LocalQueryStoreValue<T>) => void): () => void {
      const client = getReactiveBaseClient()
      let current: LocalQueryStoreValue<T> = { data: undefined, loading: true, error: null }
      run(current)

      let interval: ReturnType<typeof setInterval> | null = null
      let active = true

      const executeQuery = async () => {
        if (!active) return
        try {
          const result = await client.mutate("__local_query", { table, query })
          if (!active) return
          current = {
            data: (result as { rows: T[] })?.rows ?? (result as T[]) ?? [],
            loading: false,
            error: null,
          }
          run(current)
        } catch (err: unknown) {
          if (!active) return
          current = {
            data: current.data,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          }
          run(current)
        }
      }

      executeQuery()

      if (options?.pollIntervalMs && options.pollIntervalMs > 0) {
        interval = setInterval(executeQuery, options.pollIntervalMs)
      }

      return () => {
        active = false
        if (interval) clearInterval(interval)
      }
    },
  }
}

/**
 * Create a local mutation handle for offline-first writes.
 *
 * Usage:
 *   const { mutate } = localMutationHandle("tasks")
 *   await mutate("insert", { id: "t1", title: "Buy milk" })
 */
export function localMutationHandle(table: string): {
  mutate: (operation: "insert" | "update" | "delete", data: Record<string, unknown>) => Promise<string | undefined>
} {
  return {
    async mutate(
      operation: "insert" | "update" | "delete",
      data: Record<string, unknown>,
    ): Promise<string | undefined> {
      const client = getReactiveBaseClient()
      return (await client.mutate("__local_mutation", { table, operation, data })) as string | undefined
    },
  }
}
