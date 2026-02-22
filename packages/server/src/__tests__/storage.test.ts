import { describe, it, expect } from "vitest"
import { MemoryStorageBackend, createStorageContext } from "../storage/storage.js"
import { v } from "../schema/validators.js"

describe("MemoryStorageBackend", () => {
  it("stores and retrieves files", async () => {
    const storage = new MemoryStorageBackend()

    const id = await storage.put(Buffer.from("hello"), { contentType: "text/plain" })
    expect(id).toBeDefined()

    const exists = await storage.exists(id)
    expect(exists).toBe(true)

    const data = storage.getData(id)
    expect(data?.toString()).toBe("hello")
  })

  it("generates memory:// URLs", async () => {
    const storage = new MemoryStorageBackend()
    const id = await storage.put(Buffer.from("test"), {})

    const url = await storage.getUrl(id)
    expect(url).toContain("memory://")
  })

  it("deletes files", async () => {
    const storage = new MemoryStorageBackend()
    const id = await storage.put(Buffer.from("delete me"), {})

    await storage.delete(id)
    expect(await storage.exists(id)).toBe(false)
    expect(storage.size).toBe(0)
  })

  it("tracks file count", async () => {
    const storage = new MemoryStorageBackend()
    expect(storage.size).toBe(0)

    await storage.put(Buffer.from("a"), {})
    await storage.put(Buffer.from("b"), {})
    expect(storage.size).toBe(2)

    storage.clear()
    expect(storage.size).toBe(0)
  })
})

describe("createStorageContext", () => {
  it("wraps backend as a function context", async () => {
    const backend = new MemoryStorageBackend()
    const ctx = createStorageContext(backend)

    const id = await ctx.upload(Buffer.from("test data"), { contentType: "text/plain" })
    expect(id).toBeDefined()

    const url = await ctx.getUrl(id)
    expect(url).toContain(id)

    await ctx.delete(id)
    expect(await backend.exists(id)).toBe(false)
  })

  it("handles string uploads", async () => {
    const backend = new MemoryStorageBackend()
    const ctx = createStorageContext(backend)

    const id = await ctx.upload("hello world", { contentType: "text/plain" })
    expect(backend.getData(id)?.toString()).toBe("hello world")
  })
})

describe("v.storageId()", () => {
  it("creates a storage ID validator", () => {
    const validator = v.storageId()
    expect(validator.type).toBe("id")
    expect(validator.pgType).toBe("text")
  })
})
