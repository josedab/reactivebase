import { describe, it, expect, beforeEach } from "vitest"
import {
  WasmFunctionRuntime,
  WasmRuntimeError,
} from "../wasm-runtime/wasm-runtime.js"

// Helper to create a fake Wasm-like module bytes
function createFakeWasmBytes(size = 100): Uint8Array {
  const bytes = new Uint8Array(size)
  // Wasm magic number
  bytes[0] = 0x00
  bytes[1] = 0x61
  bytes[2] = 0x73
  bytes[3] = 0x6d
  return bytes
}

describe("WasmFunctionRuntime", () => {
  let runtime: WasmFunctionRuntime

  beforeEach(() => {
    runtime = new WasmFunctionRuntime({ memoryLimitMB: 64 })
  })

  describe("host functions", () => {
    it("registers host functions", () => {
      runtime.registerHostFunction("db.query", async (sql) => ({ rows: [] }))
      expect(runtime.listHostFunctions()).toHaveLength(1)
      expect(runtime.listHostFunctions()[0].name).toBe("db.query")
    })

    it("validates host function name", () => {
      expect(() => runtime.registerHostFunction("", () => {})).toThrow("name is required")
    })

    it("unregisters host functions", () => {
      runtime.registerHostFunction("test", () => {})
      runtime.unregisterHostFunction("test")
      expect(runtime.listHostFunctions()).toHaveLength(0)
    })
  })

  describe("compilation", () => {
    it("compiles a module", async () => {
      const module = await runtime.compile("test", createFakeWasmBytes())
      expect(module.name).toBe("test")
      expect(module.status).toBe("ready")
      expect(module.compileTimeMs).toBeGreaterThanOrEqual(0)
    })

    it("validates module name", async () => {
      await expect(runtime.compile("", createFakeWasmBytes())).rejects.toThrow("name is required")
    })

    it("validates module source", async () => {
      await expect(runtime.compile("test", new Uint8Array(0))).rejects.toThrow("source is required")
    })

    it("rejects oversized modules", async () => {
      const small = new WasmFunctionRuntime({ maxModuleSize: 50 })
      await expect(small.compile("big", createFakeWasmBytes(100))).rejects.toThrow("exceeds limit")
    })

    it("retrieves compiled modules", async () => {
      await runtime.compile("test", createFakeWasmBytes())
      expect(runtime.getModule("test")).toBeDefined()
      expect(runtime.getModule("test")?.status).toBe("ready")
    })

    it("lists all modules", async () => {
      await runtime.compile("a", createFakeWasmBytes())
      await runtime.compile("b", createFakeWasmBytes())
      expect(runtime.listModules()).toHaveLength(2)
    })

    it("removes modules", async () => {
      await runtime.compile("test", createFakeWasmBytes())
      runtime.removeModule("test")
      expect(runtime.getModule("test")).toBeUndefined()
    })
  })

  describe("execution", () => {
    it("executes a compiled module", async () => {
      await runtime.compile("test", createFakeWasmBytes())
      const result = await runtime.execute("test", { value: 42 })
      expect(result.success).toBe(true)
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
    })

    it("returns error for missing module", async () => {
      await expect(runtime.execute("missing")).rejects.toThrow("not found")
    })

    it("uses host functions during execution", async () => {
      runtime.registerHostFunction("transform", (args) => ({
        ...(args as object),
        transformed: true,
      }))
      await runtime.compile("test", createFakeWasmBytes())
      const result = await runtime.execute<{ value: number; transformed: boolean }>(
        "test",
        { value: 42 },
      )
      expect(result.success).toBe(true)
      expect(result.result?.transformed).toBe(true)
      expect(result.hostCallCount).toBe(1)
    })

    it("tracks execution stats", async () => {
      await runtime.compile("test", createFakeWasmBytes())
      await runtime.execute("test", {})
      await runtime.execute("test", {})
      const stats = runtime.getStats()
      expect(stats.totalExecutions).toBe(2)
      expect(stats.successfulExecutions).toBe(2)
      expect(stats.failedExecutions).toBe(0)
    })
  })

  describe("portable bundles", () => {
    it("creates a portable bundle", async () => {
      await runtime.compile("a", createFakeWasmBytes())
      await runtime.compile("b", createFakeWasmBytes())
      const bundle = runtime.createBundle(["a", "b"])
      expect(bundle.format).toBe("reactivebase-wasm-v1")
      expect(bundle.modules).toHaveLength(2)
      expect(bundle.targets.length).toBeGreaterThan(0)
    })

    it("throws for missing module in bundle", async () => {
      expect(() => runtime.createBundle(["missing"])).toThrow("not found")
    })

    it("loads from a portable bundle", async () => {
      await runtime.compile("test", createFakeWasmBytes(50))
      const bundle = runtime.createBundle(["test"])

      const runtime2 = new WasmFunctionRuntime()
      const result = await runtime2.loadBundle(bundle)
      expect(result.loaded).toContain("test")
      expect(runtime2.getModule("test")?.status).toBe("ready")
    })

    it("rejects invalid bundle format", async () => {
      const runtime2 = new WasmFunctionRuntime()
      await expect(
        runtime2.loadBundle({ format: "invalid" as any, modules: [], requiredHostFunctions: [], targets: [], createdAt: "" }),
      ).rejects.toThrow("Unsupported bundle format")
    })
  })

  describe("runtime detection", () => {
    it("detects runtime target", () => {
      expect(runtime.runtime).toBe("node")
    })

    it("uses explicit target", () => {
      const rt = new WasmFunctionRuntime({ targetRuntime: "cloudflare-workers" })
      expect(rt.runtime).toBe("cloudflare-workers")
    })
  })

  describe("stats", () => {
    it("provides comprehensive stats", async () => {
      await runtime.compile("test", createFakeWasmBytes())
      await runtime.execute("test", {})
      const stats = runtime.getStats()
      expect(stats.totalModules).toBe(1)
      expect(stats.totalExecutions).toBe(1)
      expect(stats.averageExecutionMs).toBeGreaterThanOrEqual(0)
    })
  })
})
