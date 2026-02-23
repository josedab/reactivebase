/**
 * ReactiveBase Svelte stores.
 * Implements the Svelte store contract (subscribe method) backed by
 * ReactiveBase client subscriptions for seamless reactive data binding.
 */

import { ReactiveBaseClient, type ReactiveBaseClientOptions } from "@reactivebase/client"

// --- Client management ---

let globalClient: ReactiveBaseClient | null = null

/**
 * Initialize the ReactiveBase client for Svelte.
 * Call once at app startup.
 */
export function initReactiveBase(options: ReactiveBaseClientOptions): ReactiveBaseClient {
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
