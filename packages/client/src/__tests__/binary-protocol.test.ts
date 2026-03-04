/**
 * Tests for Binary Protocol — encode/decode, error paths,
 * empty messages, unknown types, truncation, and compression ratio.
 */

import { describe, it, expect } from "vitest"
import { encodeMessage, decodeMessage, isBinaryMessage, compressionRatio } from "../protocol/binary-protocol.js"

// ─── encodeMessage ───────────────────────────────────────────────────────────

describe("encodeMessage", () => {
  it("encodes a subscribe message", () => {
    const buffer = encodeMessage({ type: "subscribe", subscriptionId: "sub_1", queryName: "tasks" })
    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect(buffer.byteLength).toBeGreaterThan(1)

    const view = new Uint8Array(buffer)
    expect(view[0]).toBe(0x01) // subscribe type byte
  })

  it("encodes all client message types", () => {
    const clientTypes = ["subscribe", "unsubscribe", "mutate", "action", "ping", "auth"]
    for (const type of clientTypes) {
      const buffer = encodeMessage({ type })
      expect(buffer.byteLength).toBeGreaterThanOrEqual(1)
    }
  })

  it("encodes all server message types", () => {
    const serverTypes = [
      "subscription_data",
      "subscription_update",
      "subscription_error",
      "mutation_result",
      "mutation_error",
      "action_result",
      "action_error",
      "pong",
      "auth_result",
    ]
    for (const type of serverTypes) {
      const buffer = encodeMessage({ type })
      expect(buffer.byteLength).toBeGreaterThanOrEqual(1)
    }
  })

  it("throws for unknown message type", () => {
    expect(() => encodeMessage({ type: "nonexistent" })).toThrow("Unknown message type")
  })

  it("strips type field from payload", () => {
    const buffer = encodeMessage({ type: "ping" })
    const view = new Uint8Array(buffer)
    // Payload is {} → "{}"
    const payload = new TextDecoder().decode(view.slice(1))
    expect(JSON.parse(payload)).toEqual({})
  })

  it("preserves all non-type fields in payload", () => {
    const buffer = encodeMessage({
      type: "subscribe",
      subscriptionId: "sub_1",
      queryName: "tasks",
      args: { filter: true },
    })
    const decoded = decodeMessage(buffer)
    expect(decoded.subscriptionId).toBe("sub_1")
    expect(decoded.queryName).toBe("tasks")
    expect(decoded.args).toEqual({ filter: true })
  })
})

// ─── decodeMessage ───────────────────────────────────────────────────────────

describe("decodeMessage", () => {
  it("decodes a roundtrip message", () => {
    const original = { type: "mutate", requestId: "mut_1", mutationName: "tasks.create", args: { title: "Test" } }
    const buffer = encodeMessage(original)
    const decoded = decodeMessage(buffer)

    expect(decoded.type).toBe("mutate")
    expect(decoded.requestId).toBe("mut_1")
    expect(decoded.mutationName).toBe("tasks.create")
    expect(decoded.args).toEqual({ title: "Test" })
  })

  it("throws for empty message (0 bytes)", () => {
    const buffer = new ArrayBuffer(0)
    expect(() => decodeMessage(buffer)).toThrow("Empty message")
  })

  it("throws for unknown message type byte", () => {
    const buffer = new ArrayBuffer(3)
    const view = new Uint8Array(buffer)
    view[0] = 0xff // invalid type byte
    view[1] = 0x7b // {
    view[2] = 0x7d // }
    expect(() => decodeMessage(buffer)).toThrow("Unknown message type byte")
  })

  it("handles message with type byte only (no payload)", () => {
    const buffer = new ArrayBuffer(1)
    const view = new Uint8Array(buffer)
    view[0] = 0x05 // ping
    const decoded = decodeMessage(buffer)
    expect(decoded.type).toBe("ping")
  })

  it("throws for corrupted payload (valid header, invalid JSON body)", () => {
    const buffer = new ArrayBuffer(4)
    const view = new Uint8Array(buffer)
    view[0] = 0x01 // subscribe
    view[1] = 0x7b // {
    view[2] = 0x21 // !  ← invalid JSON
    view[3] = 0x7d // }
    expect(() => decodeMessage(buffer)).toThrow() // JSON.parse error
  })

  it("handles truncated message (partial header — valid type, truncated JSON)", () => {
    const buffer = new ArrayBuffer(2)
    const view = new Uint8Array(buffer)
    view[0] = 0x01 // subscribe
    view[1] = 0x7b // { ← incomplete JSON
    expect(() => decodeMessage(buffer)).toThrow() // JSON.parse error
  })

  it("roundtrips all 15 message types", () => {
    const types = [
      "subscribe",
      "unsubscribe",
      "mutate",
      "action",
      "ping",
      "auth",
      "subscription_data",
      "subscription_update",
      "subscription_error",
      "mutation_result",
      "mutation_error",
      "action_result",
      "action_error",
      "pong",
      "auth_result",
    ]
    for (const type of types) {
      const msg = { type, data: `test_${type}` }
      const decoded = decodeMessage(encodeMessage(msg))
      expect(decoded.type).toBe(type)
      expect(decoded.data).toBe(`test_${type}`)
    }
  })

  it("preserves nested objects and arrays", () => {
    const msg = {
      type: "subscription_data",
      subscriptionId: "sub_1",
      data: {
        tasks: [{ id: 1, nested: { deep: true } }],
        count: 42,
      },
      version: 5,
    }
    const decoded = decodeMessage(encodeMessage(msg))
    expect(decoded.data).toEqual({
      tasks: [{ id: 1, nested: { deep: true } }],
      count: 42,
    })
  })

  it("handles zero-length payload (type byte only equivalent to empty JSON)", () => {
    // Type byte only — ping with no payload
    const buffer = new ArrayBuffer(1)
    new Uint8Array(buffer)[0] = 0x17 // pong
    const decoded = decodeMessage(buffer)
    expect(decoded).toEqual({ type: "pong" })
  })
})

// ─── isBinaryMessage ─────────────────────────────────────────────────────────

describe("isBinaryMessage", () => {
  it("returns true for ArrayBuffer", () => {
    expect(isBinaryMessage(new ArrayBuffer(8))).toBe(true)
  })

  it("returns false for string", () => {
    expect(isBinaryMessage("hello")).toBe(false)
  })

  it("returns false for null/undefined", () => {
    expect(isBinaryMessage(null)).toBe(false)
    expect(isBinaryMessage(undefined)).toBe(false)
  })

  it("returns false for plain object", () => {
    expect(isBinaryMessage({ type: "subscribe" })).toBe(false)
  })

  it("returns false for Uint8Array", () => {
    // Uint8Array is NOT an ArrayBuffer
    expect(isBinaryMessage(new Uint8Array(8))).toBe(false)
  })
})

// ─── compressionRatio ────────────────────────────────────────────────────────

describe("compressionRatio", () => {
  it("returns positive ratio for typical message", () => {
    const msg = { type: "subscribe", subscriptionId: "sub_1", queryName: "tasks.list", args: {} }
    const ratio = compressionRatio(msg)
    // Binary format saves the "type" field → should save some bytes
    expect(ratio).toBeGreaterThan(0)
    expect(ratio).toBeLessThan(1)
  })

  it("returns ratio for minimal message", () => {
    const msg = { type: "ping" }
    const ratio = compressionRatio(msg)
    expect(typeof ratio).toBe("number")
  })

  it("returns ratio for large message", () => {
    const msg = {
      type: "subscription_data",
      subscriptionId: "sub_1",
      data: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: "A long description for testing compression ratio calculations",
      })),
      version: 42,
    }
    const ratio = compressionRatio(msg)
    expect(ratio).toBeGreaterThan(0)
  })
})

// ─── Edge cases: interleaved / mixed ─────────────────────────────────────────

describe("edge cases", () => {
  it("handles message with special characters in payload", () => {
    const msg = { type: "mutate", data: 'Hello "World" \n \t 🚀' }
    const decoded = decodeMessage(encodeMessage(msg))
    expect(decoded.data).toBe('Hello "World" \n \t 🚀')
  })

  it("handles message with empty string values", () => {
    const msg = { type: "subscribe", queryName: "", args: "" }
    const decoded = decodeMessage(encodeMessage(msg))
    expect(decoded.queryName).toBe("")
    expect(decoded.args).toBe("")
  })

  it("handles message with null values", () => {
    const msg = { type: "mutation_result", requestId: "r1", data: null }
    const decoded = decodeMessage(encodeMessage(msg))
    expect(decoded.data).toBeNull()
  })

  it("handles message with numeric values", () => {
    const msg = { type: "subscription_data", version: 0, count: -1, float: 3.14 }
    const decoded = decodeMessage(encodeMessage(msg))
    expect(decoded.version).toBe(0)
    expect(decoded.count).toBe(-1)
    expect(decoded.float).toBe(3.14)
  })

  it("handles message with boolean values", () => {
    const msg = { type: "auth_result", success: true, isAdmin: false }
    const decoded = decodeMessage(encodeMessage(msg))
    expect(decoded.success).toBe(true)
    expect(decoded.isAdmin).toBe(false)
  })

  it("maximum reasonable message size encodes/decodes", () => {
    const largePayload = "x".repeat(100_000)
    const msg = { type: "subscription_data", data: largePayload }
    const buffer = encodeMessage(msg)
    expect(buffer.byteLength).toBeGreaterThan(100_000)

    const decoded = decodeMessage(buffer)
    expect((decoded.data as string).length).toBe(100_000)
  })
})
