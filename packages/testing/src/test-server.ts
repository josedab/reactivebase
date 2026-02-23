/**
 * Test server and helpers for running ReactiveBase functions in tests
 * without a real Postgres connection or WebSocket server.
 */

import type { Schema } from "@reactivebase/server"
import { createAuthContext, type AuthContext } from "@reactivebase/server"
import { MockDatabase, type MockDatabaseContext } from "./mock-database.js"

export interface TestServerOptions {
  schema?: Schema
  auth?: AuthContext
}

/**
 * Lightweight test server for executing queries, mutations, and actions
 * against an in-memory mock database.
 */
export class TestServer {
  readonly db: MockDatabase
  private auth: AuthContext
  private functions = new Map<string, { type: string; handler: Function }>()

  constructor(options: TestServerOptions = {}) {
    this.db = new MockDatabase(options.schema)
    this.auth = options.auth ?? createAuthContext(null)
  }

  /**
   * Register functions for testing.
   */
  registerFunctions(fns: Record<string, { type: string; handler: Function }>): void {
    for (const [name, fn] of Object.entries(fns)) {
      this.functions.set(name, fn)
    }
  }

  /**
   * Set the auth context for subsequent function calls.
   */
  setAuth(auth: AuthContext): void {
    this.auth = auth
  }

  /**
   * Set auth to an authenticated user.
   */
  asUser(userId: string, claims: Record<string, unknown> = {}): void {
    this.auth = createAuthContext(userId, claims)
  }

  /**
   * Set auth to unauthenticated.
   */
  asAnonymous(): void {
    this.auth = createAuthContext(null)
  }

  /**
   * Run a query function and return the result.
   */
  async runQuery<T = unknown>(
    fnOrRef: { handler: Function } | string,
    args: unknown = {},
  ): Promise<QueryTestResult<T>> {
    const { handler } = this.resolveFunction(fnOrRef, "query")
    const dbCtx = this.db.createContext("read")
    const ctx = this.createFunctionContext(dbCtx)

    const result = await handler(ctx, args)

    // If result is thenable (mock query builder), await it
    const resolved = result && typeof result === "object" && "then" in result ? await result : result

    return {
      data: resolved as T,
      dependencies: dbCtx.getDependencies(),
    }
  }

  /**
   * Run a mutation function and return the result.
   */
  async runMutation<T = unknown>(
    fnOrRef: { handler: Function } | string,
    args: unknown = {},
  ): Promise<MutationTestResult<T>> {
    const { handler } = this.resolveFunction(fnOrRef, "mutation")
    const dbCtx = this.db.createContext("readwrite")
    const ctx = this.createFunctionContext(dbCtx)

    const result = await handler(ctx, args)
    const resolved = result && typeof result === "object" && "then" in result ? await result : result

    return {
      data: resolved as T,
      modifiedTables: dbCtx.getModifiedTables(),
    }
  }

  /**
   * Run an action function.
   */
  async runAction<T = unknown>(fnOrRef: { handler: Function } | string, args: unknown = {}): Promise<T> {
    const { handler } = this.resolveFunction(fnOrRef, "action")
    const dbCtx = this.db.createContext("readwrite")
    const ctx = this.createFunctionContext(dbCtx)

    const result = await handler(ctx, args)
    return (result && typeof result === "object" && "then" in result ? await result : result) as T
  }

  /**
   * Test that a mutation modifies specific tables.
   */
  async expectMutationToModify(
    fnOrRef: { handler: Function } | string,
    args: unknown,
    expectedTables: string[],
  ): Promise<void> {
    const result = await this.runMutation(fnOrRef, args)
    const missing = expectedTables.filter((t) => !result.modifiedTables.includes(t))
    if (missing.length > 0) {
      throw new Error(
        `Expected mutation to modify tables [${expectedTables.join(", ")}] ` +
          `but missing: [${missing.join(", ")}]. ` +
          `Actually modified: [${result.modifiedTables.join(", ")}]`,
      )
    }
  }

  /**
   * Test that a query returns expected data.
   */
  async expectQueryToReturn<T = unknown>(
    fnOrRef: { handler: Function } | string,
    args: unknown,
    expected: T,
  ): Promise<void> {
    const result = await this.runQuery(fnOrRef, args)
    const actual = JSON.stringify(result.data)
    const exp = JSON.stringify(expected)
    if (actual !== exp) {
      throw new Error(`Query result mismatch.\nExpected: ${exp}\nActual: ${actual}`)
    }
  }

  /**
   * Snapshot reactive updates: run a query, then apply mutations,
   * and capture the query result after each mutation.
   */
  async snapshotReactiveUpdates<T = unknown>(
    queryFn: { handler: Function } | string,
    queryArgs: unknown,
    mutations: Array<{
      fn: { handler: Function } | string
      args: unknown
    }>,
  ): Promise<ReactiveSnapshot<T>[]> {
    const snapshots: ReactiveSnapshot<T>[] = []

    // Initial query
    const initial = await this.runQuery<T>(queryFn, queryArgs)
    snapshots.push({ step: 0, label: "initial", data: initial.data })

    // Apply each mutation and re-query
    for (let i = 0; i < mutations.length; i++) {
      const { fn, args } = mutations[i]
      await this.runMutation(fn, args)
      const after = await this.runQuery<T>(queryFn, queryArgs)
      snapshots.push({ step: i + 1, label: `after mutation ${i}`, data: after.data })
    }

    return snapshots
  }

  /**
   * Reset the test server state.
   */
  reset(): void {
    this.db.reset()
    this.auth = createAuthContext(null)
  }

  private resolveFunction(fnOrRef: { handler: Function } | string, _expectedType?: string) {
    if (typeof fnOrRef === "string") {
      const fn = this.functions.get(fnOrRef)
      if (!fn) throw new Error(`Function not found: ${fnOrRef}`)
      return fn
    }
    return fnOrRef
  }

  private createFunctionContext(dbCtx: MockDatabaseContext) {
    return {
      db: dbCtx,
      auth: this.auth,
      scheduler: {
        async runAfter() {
          return "mock_job_id"
        },
        async runAt() {
          return "mock_job_id"
        },
      },
      log: {
        debug() {},
        info() {},
        warn() {},
        error() {},
      },
    }
  }
}

export interface QueryTestResult<T = unknown> {
  data: T
  dependencies: Array<{ table: string; filters: Record<string, unknown> }>
}

export interface MutationTestResult<T = unknown> {
  data: T
  modifiedTables: string[]
}

export interface ReactiveSnapshot<T = unknown> {
  step: number
  label: string
  data: T
}

/**
 * Create a test server with optional schema.
 */
export function createTestServer(options: TestServerOptions = {}): TestServer {
  return new TestServer(options)
}
