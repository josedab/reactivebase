/**
 * ReactiveBase Vue composables.
 * Provides useQuery, useMutation, and useAction for Vue 3 Composition API.
 */

import { ref, shallowRef, onMounted, onUnmounted, watch, inject, provide, type Ref, type InjectionKey } from "vue"
import {
  ReactiveBaseClient,
  type ReactiveBaseClientOptions,
  type ClientSubscriptionMiddleware,
} from "@reactivebase/client"

// --- Provider ---

const REACTIVEBASE_KEY: InjectionKey<ReactiveBaseClient> = Symbol("reactivebase-client")

export interface ReactiveBaseVueOptions extends ReactiveBaseClientOptions {
  /** Client-side subscription middleware pipeline */
  middleware?: ClientSubscriptionMiddleware[]
}

/**
 * Provide a ReactiveBase client to descendant components.
 * Call in the setup() of your root App component.
 */
export function provideReactiveBase(options: ReactiveBaseVueOptions): ReactiveBaseClient {
  const client = new ReactiveBaseClient(options)
  provide(REACTIVEBASE_KEY, client)
  return client
}

/**
 * Inject the ReactiveBase client from a parent provider.
 */
export function useReactiveBaseClient(): ReactiveBaseClient {
  const client = inject(REACTIVEBASE_KEY)
  if (!client) {
    throw new Error("ReactiveBase client not found. Call provideReactiveBase() in a parent component.")
  }
  return client
}

// --- Composables ---

export interface FunctionReference {
  _name: string
  _type: "query" | "mutation" | "action"
}

/**
 * Subscribe to a reactive query.
 * Returns a reactive ref that updates when server pushes changes.
 */
export function useQuery<T = unknown>(
  queryRef: FunctionReference | string,
  args?: Ref<unknown> | unknown,
): { data: Ref<T | undefined>; error: Ref<Error | null>; isLoading: Ref<boolean> } {
  const client = useReactiveBaseClient()
  const queryName = typeof queryRef === "string" ? queryRef : queryRef._name

  const data = shallowRef<T | undefined>(undefined)
  const error = ref<Error | null>(null)
  const isLoading = ref(true)

  let unsubscribe: (() => void) | null = null

  const subscribe = (currentArgs: unknown) => {
    unsubscribe?.()
    data.value = undefined
    error.value = null
    isLoading.value = true

    unsubscribe = client.subscribe(queryName, currentArgs, (result, err) => {
      isLoading.value = false
      if (err) {
        error.value = err
      } else {
        data.value = result as T
      }
    })
  }

  onMounted(() => {
    const resolvedArgs = args && typeof args === "object" && "value" in args ? (args as Ref).value : args
    subscribe(resolvedArgs)
  })

  // Watch for arg changes if args is a ref
  if (args && typeof args === "object" && "value" in args) {
    watch(args as Ref, (newArgs) => {
      subscribe(newArgs)
    })
  }

  onUnmounted(() => {
    unsubscribe?.()
  })

  return { data: data as Ref<T | undefined>, error, isLoading }
}

/**
 * Returns a function that calls a server mutation.
 */
export function useMutation<TArgs = unknown, TResult = unknown>(
  mutationRef: FunctionReference | string,
): {
  mutate: (args: TArgs) => Promise<TResult>
  isLoading: Ref<boolean>
  error: Ref<Error | null>
} {
  const client = useReactiveBaseClient()
  const mutationName = typeof mutationRef === "string" ? mutationRef : mutationRef._name

  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  async function mutate(args: TArgs): Promise<TResult> {
    isLoading.value = true
    error.value = null

    try {
      const result = await client.mutate(mutationName, args)
      return result as TResult
    } catch (err: unknown) {
      error.value = err instanceof Error ? err : new Error(String(err))
      throw err
    } finally {
      isLoading.value = false
    }
  }

  return { mutate, isLoading, error }
}

/**
 * Returns a function that triggers a background action.
 */
export function useAction<TArgs = unknown, TResult = unknown>(
  actionRef: FunctionReference | string,
): {
  run: (args: TArgs) => Promise<TResult>
  isLoading: Ref<boolean>
  error: Ref<Error | null>
} {
  const client = useReactiveBaseClient()
  const actionName = typeof actionRef === "string" ? actionRef : actionRef._name

  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  async function run(args: TArgs): Promise<TResult> {
    isLoading.value = true
    error.value = null

    try {
      const result = await client.runAction(actionName, args)
      return result as TResult
    } catch (err: unknown) {
      error.value = err instanceof Error ? err : new Error(String(err))
      throw err
    } finally {
      isLoading.value = false
    }
  }

  return { run, isLoading, error }
}

// Pre-built reactive UI composables
export { useReactiveTable, useReactiveForm, usePresenceAvatars } from "./components.js"
export type {
  VueTableColumn,
  UseReactiveTableOptions,
  UseReactiveTableReturn,
  VueFormField,
  UseReactiveFormOptions,
  UseReactiveFormReturn,
  VuePresenceUser,
  UsePresenceAvatarsOptions,
  UsePresenceAvatarsReturn,
} from "./components.js"

// Collaboration composables (CRDT + awareness)
export {
  useCollabText,
  useCollabList,
  useCollabMap,
  useCollabCounter,
  useCursors,
  useTypingUsers,
} from "./collaboration.js"
export type {
  CursorData,
  TypingUser,
  UseCollabTextReturn,
  UseCollabListReturn,
  UseCollabMapReturn,
  UseCollabCounterReturn,
  UseCursorsReturn,
  UseTypingUsersReturn,
} from "./collaboration.js"

// ─── Local-First Composables ─────────────────────────────────────────────────

export interface LocalQueryFilter {
  where?: Record<string, unknown>
  orderBy?: Array<{ column: string; direction?: "ASC" | "DESC" }>
  limit?: number
  offset?: number
}

/**
 * Read data from the local SQLite-backed store.
 * Returns reactive refs that update when data changes.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useLocalQuery<Task>("tasks", { where: { done: 0 } })
 */
export function useLocalQuery<T = Record<string, unknown>>(
  table: string,
  query?: Ref<LocalQueryFilter | undefined> | LocalQueryFilter,
  options?: { enabled?: Ref<boolean> | boolean; pollIntervalMs?: number },
): {
  data: Ref<T[] | undefined>
  loading: Ref<boolean>
  error: Ref<Error | null>
  refetch: () => void
} {
  const client = useReactiveBaseClient()
  const data = shallowRef<T[] | undefined>(undefined)
  const loading = ref(true)
  const error = ref<Error | null>(null)

  const resolveQuery = (): LocalQueryFilter | undefined => {
    if (!query) return undefined
    if (typeof query === "object" && "value" in query) return (query as Ref).value as LocalQueryFilter | undefined
    return query
  }

  const resolveEnabled = (): boolean => {
    if (options?.enabled === undefined) return true
    if (typeof options.enabled === "object" && "value" in options.enabled)
      return (options.enabled as Ref).value as boolean
    return options.enabled as boolean
  }

  const executeQuery = async () => {
    if (!resolveEnabled()) {
      loading.value = false
      return
    }

    loading.value = true
    error.value = null

    try {
      const result = await client.mutate("__local_query", { table, query: resolveQuery() })
      data.value = (result as { rows: T[] })?.rows ?? (result as T[]) ?? []
    } catch (err: unknown) {
      error.value = err instanceof Error ? err : new Error(String(err))
      data.value = undefined
    } finally {
      loading.value = false
    }
  }

  const refetch = () => {
    executeQuery()
  }

  onMounted(() => {
    executeQuery()
  })

  // Watch query changes
  if (query && typeof query === "object" && "value" in query) {
    watch(query as Ref, () => executeQuery())
  }

  // Polling
  if (options?.pollIntervalMs && options.pollIntervalMs > 0) {
    let interval: ReturnType<typeof setInterval> | null = null
    onMounted(() => {
      interval = setInterval(executeQuery, options.pollIntervalMs!)
    })
    onUnmounted(() => {
      if (interval) clearInterval(interval)
    })
  }

  return { data: data as Ref<T[] | undefined>, loading, error, refetch }
}

/**
 * Write to the local SQLite-backed store.
 * Mutations are applied locally first (instant) and queued for server sync.
 *
 * Usage:
 *   const { mutate, loading, error } = useLocalMutation("tasks")
 *   await mutate("insert", { id: "t1", title: "Buy milk", done: 0 })
 */
export function useLocalMutation(table: string): {
  mutate: (operation: "insert" | "update" | "delete", data: Record<string, unknown>) => Promise<string | undefined>
  loading: Ref<boolean>
  error: Ref<Error | null>
} {
  const client = useReactiveBaseClient()
  const loading = ref(false)
  const error = ref<Error | null>(null)

  async function mutate(
    operation: "insert" | "update" | "delete",
    data: Record<string, unknown>,
  ): Promise<string | undefined> {
    loading.value = true
    error.value = null

    try {
      const result = await client.mutate("__local_mutation", { table, operation, data })
      return result as string | undefined
    } catch (err: unknown) {
      error.value = err instanceof Error ? err : new Error(String(err))
      throw err
    } finally {
      loading.value = false
    }
  }

  return { mutate, loading, error }
}
