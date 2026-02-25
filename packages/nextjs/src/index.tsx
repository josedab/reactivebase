/**
 * ReactiveBase Next.js integration.
 *
 * Provides SSR preloading for Server Components and seamless
 * hydration to live subscriptions on the client.
 */

"use client"

import { createContext, useContext, useMemo, useEffect, useState, type ReactNode } from "react"
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
