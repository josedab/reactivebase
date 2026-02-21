/**
 * ReactiveBase Edge Runtime adapter.
 * Provides query prefetching via HTTP for edge workers (Cloudflare Workers,
 * Vercel Edge, Deno Deploy) where WebSocket connections aren't available
 * or where you want server-side data fetching.
 *
 * Zero Node.js dependencies — pure fetch-based.
 */

export interface EdgeClientOptions {
  /** ReactiveBase server URL (e.g., "https://api.example.com") */
  serverUrl: string
  /** Auth token for authenticated queries */
  token?: string
  /** Default request timeout in ms */
  timeout?: number
  /** Custom fetch implementation (for testing or runtime compatibility) */
  fetch?: typeof globalThis.fetch
}

export interface PrefetchResult<T = unknown> {
  data: T
  serverTimestamp: number
  queryName: string
  args: unknown
  /** Cache key for deduplication */
  cacheKey: string
}

/**
 * Edge-compatible client for prefetching ReactiveBase queries via HTTP.
 * Use in edge workers, server components, or any environment where
 * WebSocket connections are impractical.
 */
export class EdgeClient {
  private serverUrl: string
  private token?: string
  private timeout: number
  private fetchFn: typeof globalThis.fetch

  constructor(options: EdgeClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, "")
    this.token = options.token
    this.timeout = options.timeout ?? 10_000
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  /**
   * Prefetch a query result via HTTP POST to /query.
   * Returns serializable result suitable for SSR hydration.
   */
  async prefetchQuery<T = unknown>(
    queryName: string,
    args: unknown = {},
  ): Promise<PrefetchResult<T>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`
      }

      const response = await this.fetchFn(`${this.serverUrl}/query`, {
        method: "POST",
        headers,
        body: JSON.stringify({ queryName, args }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.text()
        throw new EdgeQueryError(
          `Query "${queryName}" failed: ${response.status}`,
          response.status,
          body,
        )
      }

      const result = (await response.json()) as { data: T }

      return {
        data: result.data,
        serverTimestamp: Date.now(),
        queryName,
        args,
        cacheKey: createCacheKey(queryName, args),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Prefetch multiple queries in parallel.
   */
  async prefetchQueries(
    queries: Array<{ queryName: string; args?: unknown }>,
  ): Promise<Map<string, PrefetchResult>> {
    const results = await Promise.allSettled(
      queries.map((q) => this.prefetchQuery(q.queryName, q.args ?? {})),
    )

    const map = new Map<string, PrefetchResult>()
    for (const result of results) {
      if (result.status === "fulfilled") {
        map.set(result.value.cacheKey, result.value)
      }
    }
    return map
  }

  /**
   * Update the auth token (e.g., after token refresh).
   */
  setToken(token: string | undefined): void {
    this.token = token
  }
}

export class EdgeQueryError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(message)
    this.name = "EdgeQueryError"
  }
}

/**
 * Create a stable cache key for a query + args combination.
 */
export function createCacheKey(queryName: string, args: unknown): string {
  return `${queryName}:${JSON.stringify(args, Object.keys(args as object).sort())}`
}

/**
 * Create an edge client instance.
 */
export function createEdgeClient(options: EdgeClientOptions): EdgeClient {
  return new EdgeClient(options)
}
