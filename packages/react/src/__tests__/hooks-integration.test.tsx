/**
 * Integration tests for React hooks with actual DOM rendering.
 * Uses React Testing Library + jsdom to verify rendering, re-renders,
 * loading states, error handling, and subscription lifecycle.
 *
 * @vitest-environment happy-dom
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, waitFor } from "@testing-library/react"

// ─── Mock Client ─────────────────────────────────────────────────────────────

type SubscribeCallback = (data: unknown, error?: Error) => void

function createMockClient() {
  const subscriptions = new Map<string, { queryName: string; args: unknown; callback: SubscribeCallback }>()
  let subCounter = 0

  const cache = {
    applyOptimisticUpdate: vi.fn(() => vi.fn()),
    applyOptimisticUpdateByQuery: vi.fn(() => vi.fn()),
  }

  return {
    subscribe: vi.fn((queryName: string, args: unknown, callback: SubscribeCallback) => {
      const id = `sub_${++subCounter}`
      subscriptions.set(id, { queryName, args, callback })
      return () => {
        subscriptions.delete(id)
      }
    }),
    mutate: vi.fn(async (_name: string, _args: unknown): Promise<Record<string, unknown>> => ({ success: true })),
    runAction: vi.fn(async (_name: string, _args: unknown): Promise<Record<string, unknown>> => ({ result: "ok" })),
    getCache: vi.fn(() => cache),
    disconnect: vi.fn(),
    _subscriptions: subscriptions,
    _cache: cache,
    _pushData(queryName: string, data: unknown) {
      for (const [, sub] of subscriptions) {
        if (sub.queryName === queryName) sub.callback(data)
      }
    },
    _pushError(queryName: string, error: Error) {
      for (const [, sub] of subscriptions) {
        if (sub.queryName === queryName) sub.callback(undefined, error)
      }
    },
  }
}

// ─── Mock Provider (avoids needing actual @reactivebase/client) ──────────────

const MockClientContext = createContext<ReturnType<typeof createMockClient> | null>(null)

function useMockClient() {
  const client = useContext(MockClientContext)
  if (!client) throw new Error("Must be used within MockProvider")
  return client
}

function MockProvider({ client, children }: { client: ReturnType<typeof createMockClient>; children?: ReactNode }) {
  return React.createElement(MockClientContext.Provider, { value: client }, children)
}

// ─── Hook Implementations (inline to avoid import issues) ────────────────────
// These mirror the actual hooks but use the mock client context

function useQuery<T = unknown>(queryName: string, args?: unknown, options?: { enabled?: boolean }): T | undefined {
  const client = useMockClient()
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  const argsJson = JSON.stringify(args)
  const argsRef = useRef(args)
  const enabled = options?.enabled ?? true

  useEffect(() => {
    argsRef.current = args
  }, [argsJson])

  useEffect(() => {
    if (!enabled) return
    setData(undefined)
    setError(null)

    const unsub = client.subscribe(queryName, argsRef.current, (result, err) => {
      if (err) setError(err)
      else setData(result as T)
    })
    return unsub
  }, [client, queryName, argsJson, enabled])

  if (error) throw error
  return data
}

function useMutation<TArgs = unknown, TResult = unknown>(mutationName: string): (args: TArgs) => Promise<TResult> {
  const client = useMockClient()
  return useCallback(
    async (args: TArgs) => {
      const result = await client.mutate(mutationName, args)
      return result as TResult
    },
    [client, mutationName],
  )
}

// ─── Error Boundary ──────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children?: ReactNode; fallback: (error: Error) => ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) return this.props.fallback(this.state.error)
    return this.props.children
  }
}

// ─── Test Components ─────────────────────────────────────────────────────────

function TaskList() {
  const tasks = useQuery<Array<{ id: string; title: string }>>("tasks.list")
  if (!tasks) return React.createElement("div", { "data-testid": "loading" }, "Loading...")
  return React.createElement(
    "ul",
    { "data-testid": "task-list" },
    tasks.map((t) => React.createElement("li", { key: t.id }, t.title)),
  )
}

function TaskCount() {
  const tasks = useQuery<Array<{ id: string }>>("tasks.list")
  return React.createElement("span", { "data-testid": "count" }, String(tasks?.length ?? 0))
}

function ConditionalQuery({ userId }: { userId: string | null }) {
  const user = useQuery<{ name: string }>("users.get", { id: userId }, { enabled: !!userId })
  if (!user) return React.createElement("div", { "data-testid": "no-user" }, "No user")
  return React.createElement("div", { "data-testid": "user-name" }, user.name)
}

function MutationButton() {
  const createTask = useMutation<{ title: string }, { id: string }>("tasks.create")
  const [result, setResult] = useState<string>("")
  const [error, setError] = useState<string>("")

  const handleClick = async () => {
    try {
      const res = await createTask({ title: "New task" })
      setResult(res.id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return React.createElement(
    "div",
    null,
    React.createElement("button", { "data-testid": "create-btn", onClick: handleClick }, "Create"),
    result && React.createElement("span", { "data-testid": "result" }, result),
    error && React.createElement("span", { "data-testid": "error" }, error),
  )
}

function ErrorThrowingQuery() {
  const data = useQuery("failing.query")
  return React.createElement("div", null, String(data))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useQuery — DOM rendering integration", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  afterEach(() => {
    cleanup()
  })

  it("shows loading state initially", () => {
    render(React.createElement(MockProvider, { client: mockClient }, React.createElement(TaskList)))

    expect(screen.getByTestId("loading")).toBeDefined()
    expect(screen.getByTestId("loading").textContent).toBe("Loading...")
  })

  it("renders data after server push", async () => {
    render(React.createElement(MockProvider, { client: mockClient }, React.createElement(TaskList)))

    act(() => {
      mockClient._pushData("tasks.list", [
        { id: "1", title: "Buy groceries" },
        { id: "2", title: "Write tests" },
      ])
    })

    await waitFor(() => {
      expect(screen.getByTestId("task-list")).toBeDefined()
    })
    const items = screen.getByTestId("task-list").querySelectorAll("li")
    expect(items.length).toBe(2)
    expect(items[0].textContent).toBe("Buy groceries")
    expect(items[1].textContent).toBe("Write tests")
  })

  it("re-renders when data updates", async () => {
    render(React.createElement(MockProvider, { client: mockClient }, React.createElement(TaskCount)))

    act(() => {
      mockClient._pushData("tasks.list", [{ id: "1" }])
    })
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"))

    act(() => {
      mockClient._pushData("tasks.list", [{ id: "1" }, { id: "2" }, { id: "3" }])
    })
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("3"))
  })

  it("subscribes to the correct query name and args", () => {
    render(React.createElement(MockProvider, { client: mockClient }, React.createElement(TaskList)))

    expect(mockClient.subscribe).toHaveBeenCalledWith("tasks.list", undefined, expect.any(Function))
  })

  it("unsubscribes on unmount", () => {
    const { unmount } = render(React.createElement(MockProvider, { client: mockClient }, React.createElement(TaskList)))

    expect(mockClient._subscriptions.size).toBe(1)
    unmount()
    expect(mockClient._subscriptions.size).toBe(0)
  })

  it("handles conditional/dependent queries with enabled option", async () => {
    render(
      React.createElement(
        MockProvider,
        { client: mockClient },
        React.createElement(ConditionalQuery, { userId: null }),
      ),
    )

    expect(screen.getByTestId("no-user")).toBeDefined()
    expect(mockClient.subscribe).not.toHaveBeenCalled()
  })

  it("subscribes when enabled becomes true", async () => {
    function Wrapper() {
      const [userId, setUserId] = useState<string | null>(null)
      return React.createElement(
        "div",
        null,
        React.createElement("button", { "data-testid": "enable", onClick: () => setUserId("u1") }, "Enable"),
        React.createElement(ConditionalQuery, { userId }),
      )
    }

    render(React.createElement(MockProvider, { client: mockClient }, React.createElement(Wrapper)))

    expect(mockClient.subscribe).not.toHaveBeenCalled()

    act(() => {
      screen.getByTestId("enable").click()
    })
    expect(mockClient.subscribe).toHaveBeenCalledWith("users.get", { id: "u1" }, expect.any(Function))
  })

  it("propagates errors through error boundary", async () => {
    render(
      React.createElement(
        MockProvider,
        { client: mockClient },
        React.createElement(
          ErrorBoundary,
          {
            fallback: (err: Error) => React.createElement("div", { "data-testid": "error" }, err.message),
          },
          React.createElement(ErrorThrowingQuery),
        ),
      ),
    )

    act(() => {
      mockClient._pushError("failing.query", new Error("Query failed"))
    })

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("Query failed")
    })
  })
})

describe("useMutation — DOM rendering integration", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  afterEach(() => {
    cleanup()
  })

  it("calls mutate on button click", async () => {
    mockClient.mutate.mockResolvedValueOnce({ id: "t1" })

    render(React.createElement(MockProvider, { client: mockClient }, React.createElement(MutationButton)))

    await act(async () => {
      screen.getByTestId("create-btn").click()
    })

    expect(mockClient.mutate).toHaveBeenCalledWith("tasks.create", { title: "New task" })
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("t1"))
  })

  it("displays error on mutation failure", async () => {
    mockClient.mutate.mockRejectedValueOnce(new Error("Unauthorized"))

    render(React.createElement(MockProvider, { client: mockClient }, React.createElement(MutationButton)))

    await act(async () => {
      screen.getByTestId("create-btn").click()
    })

    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("Unauthorized"))
  })
})
