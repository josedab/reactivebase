/**
 * @reactivebase/state — Framework-Agnostic Reactive State Layer
 *
 * Syncs ReactiveBase server state with any client-side state manager.
 * Provides core reactive primitives (ReactiveStore, derived state, selectors)
 * that work independently or via adapters for Zustand, Jotai, Pinia, Nanostores.
 *
 * Usage:
 *   const store = new ReactiveStore(client)
 *   const tasks = store.query("tasks.list", { status: "active" })
 *   tasks.subscribe((data) => console.log(data))
 *
 *   // With selectors
 *   const activeTasks = store.select(tasks, (all) => all.filter(t => t.active))
 *
 *   // With optimistic updates
 *   store.mutate("tasks.complete", { id: "1" }, {
 *     optimistic: (current) => current.map(t => t.id === "1" ? { ...t, done: true } : t)
 *   })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReactiveStoreOptions {
  /** Auto-subscribe to queries on creation (default: true) */
  autoSubscribe?: boolean
  /** Enable optimistic updates (default: true) */
  enableOptimistic?: boolean
  /** Deduplication window for identical queries in ms (default: 100) */
  dedupeMs?: number
}

export interface QueryState<T = unknown> {
  data: T | undefined
  error: Error | null
  isLoading: boolean
  isLive: boolean
  lastUpdatedAt: number | null
  updateCount: number
}

export interface QueryHandle<T = unknown> {
  /** Current state */
  get(): QueryState<T>
  /** Subscribe to state changes */
  subscribe(listener: (state: QueryState<T>) => void): () => void
  /** Force refresh */
  refresh(): void
  /** Destroy the query subscription */
  destroy(): void
}

export interface SelectorHandle<T = unknown> {
  /** Current derived value */
  get(): T | undefined
  /** Subscribe to derived value changes */
  subscribe(listener: (value: T | undefined) => void): () => void
  /** Destroy */
  destroy(): void
}

export interface MutationHandle<TArgs = unknown, TResult = unknown> {
  /** Execute the mutation */
  execute(args: TArgs): Promise<TResult>
  /** Current mutation state */
  get(): MutationState<TResult>
  /** Subscribe to mutation state changes */
  subscribe(listener: (state: MutationState<TResult>) => void): () => void
}

export interface MutationState<T = unknown> {
  data: T | undefined
  error: Error | null
  isPending: boolean
  isSuccess: boolean
  isError: boolean
}

export interface OptimisticConfig<T = unknown> {
  /** Transform current data optimistically before server response */
  optimistic?: (current: T) => T
  /** Rollback on error (default: true) */
  rollbackOnError?: boolean
}

export type Subscriber<T> = (value: T) => void
export type Unsubscribe = () => void

// ─── Minimal Client Interface ────────────────────────────────────────────────

export interface StateClientAdapter {
  subscribe(queryName: string, args: unknown, callback: (data: unknown, error?: Error) => void): () => void
  mutate(mutationName: string, args: unknown): Promise<unknown>
}

// ─── Reactive Store ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<ReactiveStoreOptions> = {
  autoSubscribe: true,
  enableOptimistic: true,
  dedupeMs: 100,
}

export class ReactiveStore {
  private client: StateClientAdapter
  private options: Required<ReactiveStoreOptions>
  private queries = new Map<string, QueryHandleImpl<unknown>>()
  private selectors = new Map<string, SelectorHandleImpl<unknown>>()

  constructor(client: StateClientAdapter, options: ReactiveStoreOptions = {}) {
    this.client = client
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Create a reactive query handle.
   * Subscribes to server updates and provides a reactive state interface.
   */
  query<T = unknown>(queryName: string, args: unknown = {}): QueryHandle<T> {
    const key = `${queryName}:${JSON.stringify(args)}`

    const existing = this.queries.get(key) as QueryHandleImpl<T> | undefined
    if (existing) return existing

    const handle = new QueryHandleImpl<T>(this.client, queryName, args, this.options.autoSubscribe)
    this.queries.set(key, handle as QueryHandleImpl<unknown>)
    return handle
  }

  /**
   * Create a derived selector from a query.
   */
  select<T, R>(source: QueryHandle<T>, selector: (data: T) => R): SelectorHandle<R> {
    const handle = new SelectorHandleImpl<R>(source as QueryHandle<unknown>, selector as (data: unknown) => R)
    return handle
  }

  /**
   * Create a derived value combining multiple queries.
   */
  combine<T extends unknown[], R>(
    sources: { [K in keyof T]: QueryHandle<T[K]> },
    combiner: (...args: { [K in keyof T]: T[K] | undefined }) => R,
  ): SelectorHandle<R> {
    const handle = new CombinedSelectorImpl<R>(sources as QueryHandle<unknown>[], combiner as (...args: unknown[]) => R)
    return handle
  }

  /**
   * Execute a mutation with optional optimistic update.
   */
  async mutate<T = unknown>(mutationName: string, args: unknown, config?: OptimisticConfig<T>): Promise<T> {
    // Apply optimistic update to all matching queries
    const rollbacks: Array<() => void> = []

    if (config?.optimistic && this.options.enableOptimistic) {
      for (const handle of this.queries.values()) {
        const currentState = handle.get()
        if (currentState.data !== undefined) {
          const original = currentState.data
          try {
            const optimisticData = (config.optimistic as (data: unknown) => unknown)(currentState.data)
            handle.setOptimistic(optimisticData)
            rollbacks.push(() => handle.setOptimistic(original))
          } catch {
            // Skip this query if optimistic transform fails
          }
        }
      }
    }

    try {
      const result = await this.client.mutate(mutationName, args)
      return result as T
    } catch (error) {
      // Rollback optimistic updates on error
      if (config?.rollbackOnError !== false) {
        for (const rollback of rollbacks) {
          rollback()
        }
      }
      throw error
    }
  }

  /**
   * Create a reusable mutation handle.
   */
  mutation<TArgs = unknown, TResult = unknown>(mutationName: string): MutationHandle<TArgs, TResult> {
    return new MutationHandleImpl<TArgs, TResult>(this.client, mutationName)
  }

  /**
   * Destroy all queries and clean up.
   */
  destroy(): void {
    for (const handle of this.queries.values()) {
      handle.destroy()
    }
    this.queries.clear()
  }
}

// ─── Internal Implementations ────────────────────────────────────────────────

class QueryHandleImpl<T> implements QueryHandle<T> {
  private state: QueryState<T>
  private listeners = new Set<Subscriber<QueryState<T>>>()
  private unsubscribe: (() => void) | null = null

  constructor(
    private client: StateClientAdapter,
    private queryName: string,
    private args: unknown,
    autoSubscribe: boolean,
  ) {
    this.state = {
      data: undefined,
      error: null,
      isLoading: true,
      isLive: false,
      lastUpdatedAt: null,
      updateCount: 0,
    }

    if (autoSubscribe) {
      this.startSubscription()
    }
  }

  get(): QueryState<T> {
    return { ...this.state }
  }

  subscribe(listener: Subscriber<QueryState<T>>): Unsubscribe {
    this.listeners.add(listener)
    // Emit current state immediately
    listener(this.get())
    return () => this.listeners.delete(listener)
  }

  refresh(): void {
    this.state.isLoading = true
    this.notify()
    // Re-start subscription
    this.stopSubscription()
    this.startSubscription()
  }

  destroy(): void {
    this.stopSubscription()
    this.listeners.clear()
  }

  setOptimistic(data: unknown): void {
    this.state.data = data as T
    this.state.lastUpdatedAt = Date.now()
    this.notify()
  }

  private startSubscription(): void {
    this.unsubscribe = this.client.subscribe(this.queryName, this.args, (data, error) => {
      if (error) {
        this.state.error = error
        this.state.isLoading = false
      } else {
        this.state.data = data as T
        this.state.error = null
        this.state.isLoading = false
        this.state.isLive = true
        this.state.lastUpdatedAt = Date.now()
        this.state.updateCount++
      }
      this.notify()
    })
  }

  private stopSubscription(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  private notify(): void {
    const snapshot = this.get()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

class SelectorHandleImpl<R> implements SelectorHandle<R> {
  private value: R | undefined
  private listeners = new Set<Subscriber<R | undefined>>()
  private unsubscribe: (() => void) | null = null

  constructor(
    private source: QueryHandle<unknown>,
    private selector: (data: unknown) => R,
  ) {
    this.unsubscribe = source.subscribe((state) => {
      const newValue = state.data !== undefined ? this.selector(state.data) : undefined
      if (JSON.stringify(newValue) !== JSON.stringify(this.value)) {
        this.value = newValue
        this.notify()
      }
    })
  }

  get(): R | undefined {
    return this.value
  }

  subscribe(listener: Subscriber<R | undefined>): Unsubscribe {
    this.listeners.add(listener)
    listener(this.value)
    return () => this.listeners.delete(listener)
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    this.listeners.clear()
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.value)
    }
  }
}

class CombinedSelectorImpl<R> implements SelectorHandle<R> {
  private value: R | undefined
  private listeners = new Set<Subscriber<R | undefined>>()
  private unsubscribes: Array<() => void> = []

  constructor(sources: QueryHandle<unknown>[], combiner: (...args: unknown[]) => R) {
    const values: unknown[] = new Array(sources.length).fill(undefined)

    for (let i = 0; i < sources.length; i++) {
      const unsub = sources[i].subscribe((state) => {
        values[i] = state.data
        const newValue = combiner(...values)
        if (JSON.stringify(newValue) !== JSON.stringify(this.value)) {
          this.value = newValue
          this.notify()
        }
      })
      this.unsubscribes.push(unsub)
    }
  }

  get(): R | undefined {
    return this.value
  }

  subscribe(listener: Subscriber<R | undefined>): Unsubscribe {
    this.listeners.add(listener)
    listener(this.value)
    return () => this.listeners.delete(listener)
  }

  destroy(): void {
    for (const unsub of this.unsubscribes) {
      unsub()
    }
    this.unsubscribes = []
    this.listeners.clear()
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.value)
    }
  }
}

class MutationHandleImpl<TArgs, TResult> implements MutationHandle<TArgs, TResult> {
  private state: MutationState<TResult>
  private listeners = new Set<Subscriber<MutationState<TResult>>>()

  constructor(
    private client: StateClientAdapter,
    private mutationName: string,
  ) {
    this.state = {
      data: undefined,
      error: null,
      isPending: false,
      isSuccess: false,
      isError: false,
    }
  }

  async execute(args: TArgs): Promise<TResult> {
    this.state = { data: undefined, error: null, isPending: true, isSuccess: false, isError: false }
    this.notify()

    try {
      const result = (await this.client.mutate(this.mutationName, args)) as TResult
      this.state = { data: result, error: null, isPending: false, isSuccess: true, isError: false }
      this.notify()
      return result
    } catch (error) {
      this.state = {
        data: undefined,
        error: error instanceof Error ? error : new Error(String(error)),
        isPending: false,
        isSuccess: false,
        isError: true,
      }
      this.notify()
      throw error
    }
  }

  get(): MutationState<TResult> {
    return { ...this.state }
  }

  subscribe(listener: Subscriber<MutationState<TResult>>): Unsubscribe {
    this.listeners.add(listener)
    listener(this.get())
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    const snapshot = this.get()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { ReactiveStore as default }
