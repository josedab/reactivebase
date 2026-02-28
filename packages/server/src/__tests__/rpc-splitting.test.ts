import { describe, it, expect, beforeEach } from "vitest"
import {
  LazyFunctionRegistry,
  RpcSplitError,
  generateFunctionManifest,
  computeChunks,
  generateClientProxy,
} from "../rpc-splitting/rpc-splitting.js"

describe("LazyFunctionRegistry", () => {
  let registry: LazyFunctionRegistry

  beforeEach(() => {
    registry = new LazyFunctionRegistry()
  })

  it("registers and invokes functions", async () => {
    registry.register("users.list", async () => (args: { limit: number }) => args.limit * 2)
    const result = await registry.invoke<number>("users.list", { limit: 5 })
    expect(result.result).toBe(10)
    expect(result.functionName).toBe("users.list")
  })

  it("caches loaded functions", async () => {
    let loadCount = 0
    registry.register("test", async () => {
      loadCount++
      return () => "ok"
    })
    await registry.invoke("test")
    await registry.invoke("test")
    expect(loadCount).toBe(1)
  })

  it("checks registration", () => {
    registry.register("test", async () => () => {})
    expect(registry.has("test")).toBe(true)
    expect(registry.has("nonexistent")).toBe(false)
  })

  it("checks loaded status", async () => {
    registry.register("test", async () => () => {})
    expect(registry.isLoaded("test")).toBe(false)
    await registry.load("test")
    expect(registry.isLoaded("test")).toBe(true)
  })

  it("throws for unregistered functions", async () => {
    await expect(registry.invoke("missing")).rejects.toThrow("not registered")
  })

  it("throws for non-function loaded values", async () => {
    registry.register("bad", async () => "not a function")
    await expect(registry.invoke("bad")).rejects.toThrow("not a function")
  })

  it("validates function name", () => {
    expect(() => registry.register("", async () => {})).toThrow("name is required")
  })

  it("pre-warms functions", async () => {
    registry.register("a", async () => () => 1)
    registry.register("b", async () => () => 2)
    const result = await registry.preWarm(["a", "b"])
    expect(result.loaded).toEqual(["a", "b"])
    expect(result.failed).toHaveLength(0)
    expect(registry.isLoaded("a")).toBe(true)
    expect(registry.isLoaded("b")).toBe(true)
  })

  it("handles pre-warm failures gracefully", async () => {
    registry.register("good", async () => () => 1)
    const result = await registry.preWarm(["good", "missing"])
    expect(result.loaded).toEqual(["good"])
    expect(result.failed).toEqual(["missing"])
  })

  it("evicts from cache", async () => {
    registry.register("test", async () => () => {})
    await registry.load("test")
    expect(registry.isLoaded("test")).toBe(true)
    registry.evict("test")
    expect(registry.isLoaded("test")).toBe(false)
  })

  it("clears entire cache", async () => {
    registry.register("a", async () => () => 1)
    registry.register("b", async () => () => 2)
    await registry.preWarm(["a", "b"])
    registry.clearCache()
    expect(registry.isLoaded("a")).toBe(false)
    expect(registry.isLoaded("b")).toBe(false)
  })

  it("lists registered functions", () => {
    registry.register("a", async () => () => {})
    registry.register("b", async () => () => {})
    expect(registry.listFunctions()).toEqual(["a", "b"])
  })

  it("provides stats", async () => {
    registry.register("a", async () => () => 1)
    registry.register("b", async () => () => 2)
    await registry.invoke("a")
    const stats = registry.getStats()
    expect(stats.totalFunctions).toBe(2)
    expect(stats.loadedFunctions).toBe(1)
    expect(stats.pendingFunctions).toBe(1)
    expect(stats.coldStartFunctions).toContain("b")
  })

  it("tracks load and execute times", async () => {
    registry.register("test", async () => () => "ok")
    const result = await registry.invoke("test")
    expect(result.loadTimeMs).toBeGreaterThanOrEqual(0)
    expect(result.executeTimeMs).toBeGreaterThanOrEqual(0)
  })
})

describe("generateFunctionManifest", () => {
  const functions = [
    { name: "users.list", type: "query" as const, module: "users", exportName: "listUsers", bundleSize: 1000, dependencies: [], hot: true },
    { name: "users.create", type: "mutation" as const, module: "users", exportName: "createUser", bundleSize: 800, dependencies: ["users.list"] },
    { name: "orders.list", type: "query" as const, module: "orders", exportName: "listOrders", bundleSize: 1200, dependencies: [] },
  ]

  it("generates manifest", () => {
    const manifest = generateFunctionManifest(functions)
    expect(manifest.version).toBe("1.0")
    expect(manifest.functions).toHaveLength(3)
    expect(manifest.totalSize).toBe(3000)
  })

  it("computes chunks by module", () => {
    const chunks = computeChunks(functions, { strategy: "by-module" })
    expect(chunks).toHaveLength(2) // users, orders
    expect(chunks.find((c) => c.name === "users")?.functions).toHaveLength(2)
    expect(chunks.find((c) => c.name === "orders")?.functions).toHaveLength(1)
  })

  it("computes chunks by frequency", () => {
    const chunks = computeChunks(functions, { strategy: "by-frequency" })
    expect(chunks.find((c) => c.name === "hot")?.functions).toContain("users.list")
  })

  it("computes manual chunks", () => {
    const chunks = computeChunks(functions, {
      strategy: "manual",
      manualChunks: { main: ["users.list", "orders.list"], admin: ["users.create"] },
    })
    expect(chunks).toHaveLength(2)
    expect(chunks.find((c) => c.name === "main")?.functions).toHaveLength(2)
  })

  it("computes per-function chunks by default", () => {
    const chunks = computeChunks(functions, { strategy: "by-dependency" })
    expect(chunks).toHaveLength(3) // One per function
  })
})

describe("generateClientProxy", () => {
  it("generates client proxy code", () => {
    const manifest = generateFunctionManifest([
      { name: "users.list", type: "query", module: "users", exportName: "listUsers", dependencies: [] },
      { name: "users.create", type: "mutation", module: "users", exportName: "createUser", dependencies: [] },
    ])
    const proxy = generateClientProxy(manifest)
    expect(proxy).toContain("users_list")
    expect(proxy).toContain("rpc.query")
    expect(proxy).toContain("users_create")
    expect(proxy).toContain("rpc.mutation")
    expect(proxy).toContain("tree-shaking")
  })
})
