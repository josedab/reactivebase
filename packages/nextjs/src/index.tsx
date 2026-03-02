/**
 * ReactiveBase Next.js integration.
 *
 * Provides SSR preloading for Server Components and seamless
 * hydration to live subscriptions on the client.
 */

"use client"

import {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useState,
  useRef,
  useCallback,
  Suspense,
  type ReactNode,
} from "react"
import { ReactiveBaseClient } from "@reactivebase/client"

// --- Preloaded Query Types ---

export interface PreloadedQueryResult<T = unknown> {
  _tag: "preloaded"
  queryName: string
  args: unknown
  data: T
  serverTimestamp: number
}

/**
 * Preload a query on the server side (in RSC or getServerSideProps).
 * Returns a serializable result that can be passed to client components.
 *
 * @param serverUrl - The ReactiveBase server URL
 * @param queryName - Name of the query to preload
 * @param args - Arguments to pass to the query
 * @param options - Optional configuration including auth token
 * @returns A serializable {@link PreloadedQueryResult} for client hydration
 */
export async function preloadQuery<T = unknown>(
  serverUrl: string,
  queryName: string,
  args: unknown = {},
  options: { token?: string } = {},
): Promise<PreloadedQueryResult<T>> {
  const url = serverUrl.replace(/\/$/, "")

  // Use a one-shot HTTP fetch to get query data on the server
  // This avoids WebSocket in SSR context
  const response = await fetch(`${url}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify({ queryName, args }),
  })

  if (!response.ok) {
    throw new Error(`Preload query failed: ${response.status} ${response.statusText}`)
  }

  const result = (await response.json()) as { data: T }

  return {
    _tag: "preloaded" as const,
    queryName,
    args,
    data: result.data as T,
    serverTimestamp: Date.now(),
  }
}

// --- Client-side hooks ---

/**
 * Use a preloaded query result, automatically upgrading to a live subscription.
 * Initially returns the SSR-fetched data, then seamlessly transitions to
 * real-time updates via WebSocket.
 *
 * @param preloaded - The preloaded query result from {@link preloadQuery}
 * @returns The latest query data, updated in real-time
 */
export function usePreloadedQuery<T = unknown>(preloaded: PreloadedQueryResult<T>): T {
  const client = useNextjsClient()
  const [data, setData] = useState<T>(preloaded.data)
  const argsJson = JSON.stringify(preloaded.args)

  useEffect(() => {
    // Subscribe for live updates, starting from preloaded data
    const unsubscribe = client.subscribe(preloaded.queryName, preloaded.args, (result, error) => {
      if (!error && result !== undefined) {
        setData(result as T)
      }
    })

    return unsubscribe
  }, [client, preloaded.queryName, argsJson])

  return data
}

// --- Provider ---

const NextjsClientContext = createContext<ReactiveBaseClient | null>(null)

export interface ReactiveBaseNextjsProviderProps {
  url: string
  token?: string
  children: ReactNode
}

/**
 * ReactiveBase provider for Next.js apps.
 * Wraps the standard client with Next.js-specific handling.
 *
 * @param props - Provider props including server URL, auth token, and children
 * @returns A React context provider wrapping the children with a ReactiveBase client
 */
export function ReactiveBaseNextjsProvider({ url, token, children }: ReactiveBaseNextjsProviderProps) {
  const client = useMemo(() => new ReactiveBaseClient({ url, token }), [url, token])

  useEffect(() => {
    return () => client.disconnect()
  }, [client])

  return <NextjsClientContext.Provider value={client}>{children}</NextjsClientContext.Provider>
}

function useNextjsClient(): ReactiveBaseClient {
  const client = useContext(NextjsClientContext)
  if (!client) {
    throw new Error("usePreloadedQuery must be used within a <ReactiveBaseNextjsProvider>")
  }
  return client
}

/**
 * Check if a value is a preloaded query result.
 *
 * @param value - The value to check
 * @returns True if the value is a {@link PreloadedQueryResult}
 */
export function isPreloadedQuery(value: unknown): value is PreloadedQueryResult {
  return (
    typeof value === "object" && value !== null && "_tag" in value && (value as { _tag: string })._tag === "preloaded"
  )
}

// --- Suspense Support ---

/**
 * Create a Suspense-compatible resource from a preloaded query.
 * Wraps the promise so React Suspense can handle loading states.
 *
 * @param serverUrl - The ReactiveBase server URL
 * @param queryName - Name of the query to preload
 * @param args - Arguments to pass to the query
 * @param options - Optional configuration including auth token
 * @returns A {@link SuspenseResource} that can be read inside a Suspense boundary
 */
export function createQueryResource<T>(
  serverUrl: string,
  queryName: string,
  args: unknown = {},
  options: { token?: string } = {},
): SuspenseResource<T> {
  let status: "pending" | "success" | "error" = "pending"
  let result: T
  let error: Error

  const promise = preloadQuery<T>(serverUrl, queryName, args, options).then(
    (r) => {
      status = "success"
      result = r.data
    },
    (e) => {
      status = "error"
      error = e
    },
  )

  return {
    read(): T {
      if (status === "pending") throw promise
      if (status === "error") throw error
      return result
    },
  }
}

export interface SuspenseResource<T> {
  read(): T
}

/**
 * Preload multiple queries in parallel for streaming SSR.
 * Returns a map of query name → preloaded result.
 *
 * @param serverUrl - The ReactiveBase server URL
 * @param queries - Array of query definitions with name and optional args
 * @param options - Optional configuration including auth token
 * @returns A map of query names to their {@link PreloadedQueryResult} values
 */
export async function preloadQueries(
  serverUrl: string,
  queries: Array<{ queryName: string; args?: unknown }>,
  options: { token?: string } = {},
): Promise<Map<string, PreloadedQueryResult>> {
  const results = await Promise.allSettled(
    queries.map((q) => preloadQuery(serverUrl, q.queryName, q.args ?? {}, options)),
  )

  const map = new Map<string, PreloadedQueryResult>()
  for (const result of results) {
    if (result.status === "fulfilled") {
      map.set(result.value.queryName, result.value)
    }
  }
  return map
}

/**
 * Hook for streaming hydration.
 * Shows SSR data immediately, then upgrades to live WebSocket subscription.
 * Designed to work with React Suspense boundaries for progressive loading.
 *
 * @param preloaded - Optional preloaded query result for initial data
 * @param queryRef - The query name to subscribe to
 * @param args - Optional query arguments (falls back to preloaded args)
 * @returns An object with the latest data and whether the live subscription is active
 */
export function useStreamingQuery<T = unknown>(
  preloaded: PreloadedQueryResult<T> | undefined,
  queryRef: string,
  args?: unknown,
): { data: T | undefined; isLive: boolean } {
  const client = useNextjsClient()
  const [data, setData] = useState<T | undefined>(preloaded?.data)
  const [isLive, setIsLive] = useState(false)
  const argsJson = JSON.stringify(args ?? preloaded?.args)

  useEffect(() => {
    // Start with preloaded data
    if (preloaded?.data !== undefined) {
      setData(preloaded.data)
    }

    // Upgrade to live subscription
    const unsubscribe = client.subscribe(queryRef, args ?? preloaded?.args, (result, error) => {
      if (!error && result !== undefined) {
        setData(result as T)
        setIsLive(true)
      }
    })

    return unsubscribe
  }, [client, queryRef, argsJson])

  return { data, isLive }
}

// --- Streaming SSR & React Server Components ---

// React 19 use() hook — graceful fallback for older versions
import * as _react from "react"
const reactUse: (<T>(usable: Promise<T>) => T) | undefined =
  typeof (_react as { use?: unknown }).use === "function"
    ? (_react as unknown as { use: <T>(usable: Promise<T>) => T }).use
    : undefined

// --- RSC Types ---

export interface ServerQueryOptions {
  token?: string
  revalidate?: number
  tags?: string[]
}

export interface LoadQueryResult<T = unknown> {
  _tag: "server-loaded"
  queryName: string
  args: unknown
  data: T
  serverTimestamp: number
  revalidate?: number
  tags?: string[]
}

export interface ReactiveIslandProps<T = unknown> {
  query: string
  args?: unknown
  fallback?: ReactNode
  hydrate: boolean
  children: (data: T, isLive: boolean) => ReactNode
}

export interface StreamingBoundaryProps {
  queries: Array<{ queryName: string; args?: unknown }>
  children: (results: Map<string, { data: unknown; isLive: boolean }>) => ReactNode
  fallback?: ReactNode
}

export interface ServerQueryClient {
  query<T = unknown>(queryName: string, args?: unknown): Promise<T>
  batchQuery(queries: Array<{ queryName: string; args?: unknown }>): Promise<Map<string, unknown>>
  close(): void
}

// --- RSC Functions ---

/**
 * Load a query during React Server Component rendering.
 * Returns a serializable result for passing to client components.
 * Supports Next.js cache revalidation via `revalidate` and `tags`.
 *
 * @param serverUrl - The ReactiveBase server URL
 * @param queryName - Name of the query to load
 * @param args - Arguments to pass to the query
 * @param options - Server query options including token, revalidate interval, and cache tags
 * @returns A serializable {@link LoadQueryResult} for client component hydration
 */
export async function loadQuery<T = unknown>(
  serverUrl: string,
  queryName: string,
  args: unknown = {},
  options: ServerQueryOptions = {},
): Promise<LoadQueryResult<T>> {
  const url = serverUrl.replace(/\/$/, "")

  const fetchOptions: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify({ queryName, args }),
    ...(options.revalidate !== undefined || options.tags
      ? ({ next: { revalidate: options.revalidate, tags: options.tags } } as RequestInit)
      : {}),
  }

  const response = await fetch(`${url}/query`, fetchOptions)

  if (!response.ok) {
    throw new Error(`Server query failed: ${response.status} ${response.statusText}`)
  }

  const result = (await response.json()) as { data: T }

  return {
    _tag: "server-loaded" as const,
    queryName,
    args,
    data: result.data as T,
    serverTimestamp: Date.now(),
    revalidate: options.revalidate,
    tags: options.tags,
  }
}

/**
 * Use a server-loaded query result in a client component.
 * Hydrates to a live WebSocket subscription automatically.
 * Supports React 19 use() pattern with graceful fallback.
 *
 * @param loaded - A resolved or promised {@link LoadQueryResult} from {@link loadQuery}
 * @returns The latest query data, updated in real-time after hydration
 */
export function useServerQuery<T = unknown>(loaded: LoadQueryResult<T> | Promise<LoadQueryResult<T>>): T {
  // Support React 19 use() for promise-based results
  const resolved =
    loaded instanceof Promise
      ? reactUse
        ? reactUse(loaded)
        : (() => {
            throw loaded
          })()
      : loaded

  const client = useNextjsClient()
  const [data, setData] = useState<T>(resolved.data)
  const argsJson = JSON.stringify(resolved.args)

  useEffect(() => {
    const unsubscribe = client.subscribe(resolved.queryName, resolved.args, (result, error) => {
      if (!error && result !== undefined) {
        setData(result as T)
      }
    })

    return unsubscribe
  }, [client, resolved.queryName, argsJson])

  return data
}

// --- Selective Hydration ---

/**
 * Inner component for ReactiveIsland that subscribes to live updates.
 */
function HydratedIslandInner<T = unknown>({
  preloaded,
  children,
}: {
  preloaded: PreloadedQueryResult<T>
  children: (data: T, isLive: boolean) => ReactNode
}) {
  const { data, isLive } = useStreamingQuery<T>(preloaded, preloaded.queryName, preloaded.args)
  return <>{children(data as T, isLive)}</>
}

/**
 * Inner component for ReactiveIsland that renders static data (zero JS on client).
 */
function StaticIslandInner<T = unknown>({
  preloaded,
  children,
}: {
  preloaded: PreloadedQueryResult<T>
  children: (data: T, isLive: boolean) => ReactNode
}) {
  return <>{children(preloaded.data, false)}</>
}

/**
 * ReactiveIsland: selective hydration component.
 * When hydrate=false, renders static HTML from server data (zero JS overhead).
 * When hydrate=true, upgrades to a live WebSocket subscription on the client.
 * Uses Suspense boundary internally.
 *
 * @param props - Island props including query name, args, hydration flag, and render function
 * @returns A Suspense-wrapped component that optionally hydrates to a live subscription
 */
export function ReactiveIsland<T = unknown>({ query, args, fallback, hydrate, children }: ReactiveIslandProps<T>) {
  const resourceRef = useRef<{
    key: string
    resource: SuspenseResource<PreloadedQueryResult<T>>
  } | null>(null)

  const client = hydrate ? useNextjsClient() : null
  const serverUrl = client ? (client as unknown as { options: { url: string } }).options.url : ""
  const token = client ? (client as unknown as { options: { token?: string } }).options.token : undefined

  const resourceKey = `${query}:${JSON.stringify(args)}`

  if (!resourceRef.current || resourceRef.current.key !== resourceKey) {
    const promise = preloadQuery<T>(serverUrl, query, args, { token })
    let status: "pending" | "success" | "error" = "pending"
    let result: PreloadedQueryResult<T>
    let error: Error

    const suspended = promise.then(
      (r) => {
        status = "success"
        result = r
      },
      (e) => {
        status = "error"
        error = e
      },
    )

    resourceRef.current = {
      key: resourceKey,
      resource: {
        read(): PreloadedQueryResult<T> {
          if (status === "pending") throw suspended
          if (status === "error") throw error
          return result
        },
      },
    }
  }

  const preloaded = resourceRef.current.resource.read()

  return (
    <Suspense fallback={fallback ?? null}>
      {hydrate ? (
        <HydratedIslandInner<T> preloaded={preloaded} children={children} />
      ) : (
        <StaticIslandInner<T> preloaded={preloaded} children={children} />
      )}
    </Suspense>
  )
}

// --- Streaming Query Boundary ---

/**
 * Inner component that manages a single streaming query within the boundary.
 */
function StreamingQueryEntry({
  queryName,
  args,
  onResult,
}: {
  queryName: string
  args: unknown
  onResult: (queryName: string, data: unknown, isLive: boolean) => void
}) {
  const client = useNextjsClient()
  const argsJson = JSON.stringify(args)

  useEffect(() => {
    const unsubscribe = client.subscribe(queryName, args, (result, error) => {
      if (!error && result !== undefined) {
        onResult(queryName, result, true)
      }
    })

    return unsubscribe
  }, [client, queryName, argsJson])

  return null
}

/**
 * StreamingQueryBoundary: streaming hydration wrapper.
 * Streams SSR data progressively and auto-upgrades each query to a live
 * WebSocket subscription. Designed for <100ms TTFB contribution.
 *
 * @param props - Boundary props including queries array, render function, and fallback
 * @returns A Suspense-wrapped component managing multiple streaming queries
 */
export function StreamingQueryBoundary({ queries, children, fallback }: StreamingBoundaryProps) {
  const [results, setResults] = useState<Map<string, { data: unknown; isLive: boolean }>>(() => new Map())

  const handleResult = useCallback((queryName: string, data: unknown, isLive: boolean) => {
    setResults((prev) => {
      const next = new Map(prev)
      next.set(queryName, { data, isLive })
      return next
    })
  }, [])

  return (
    <Suspense fallback={fallback ?? null}>
      {queries.map((q) => (
        <StreamingQueryEntry key={q.queryName} queryName={q.queryName} args={q.args} onResult={handleResult} />
      ))}
      {children(results)}
    </Suspense>
  )
}

// --- Server Query Client ---

/**
 * Create a server-side query client for use in React Server Components.
 * HTTP-only (no WebSocket), supports batch queries.
 *
 * @param serverUrl - The ReactiveBase server URL
 * @param options - Optional configuration including auth token
 * @returns A {@link ServerQueryClient} with query, batchQuery, and close methods
 */
export function createServerQueryClient(serverUrl: string, options: { token?: string } = {}): ServerQueryClient {
  const url = serverUrl.replace(/\/$/, "")
  let closed = false

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  }

  return {
    async query<T = unknown>(queryName: string, args: unknown = {}): Promise<T> {
      if (closed) throw new Error("ServerQueryClient is closed")

      const response = await fetch(`${url}/query`, {
        method: "POST",
        headers,
        body: JSON.stringify({ queryName, args }),
      })

      if (!response.ok) {
        throw new Error(`Server query failed: ${response.status} ${response.statusText}`)
      }

      const result = (await response.json()) as { data: T }
      return result.data as T
    },

    async batchQuery(queries: Array<{ queryName: string; args?: unknown }>): Promise<Map<string, unknown>> {
      if (closed) throw new Error("ServerQueryClient is closed")

      const results = await Promise.allSettled(
        queries.map(async (q) => {
          const response = await fetch(`${url}/query`, {
            method: "POST",
            headers,
            body: JSON.stringify({ queryName: q.queryName, args: q.args ?? {} }),
          })

          if (!response.ok) {
            throw new Error(`Batch query '${q.queryName}' failed: ${response.status} ${response.statusText}`)
          }

          const result = (await response.json()) as { data: unknown }
          return { queryName: q.queryName, data: result.data }
        }),
      )

      const map = new Map<string, unknown>()
      for (const result of results) {
        if (result.status === "fulfilled") {
          map.set(result.value.queryName, result.value.data)
        }
      }
      return map
    },

    close() {
      closed = true
    },
  }
}
