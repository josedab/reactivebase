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
