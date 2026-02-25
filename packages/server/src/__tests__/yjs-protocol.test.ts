import { describe, it, expect } from "vitest"
import {
  writeVarUint,
  readVarUint,
  writeVarBytes,
  readVarBytes,
  writeVarString,
  readVarString,
  encodeStateVector,
  decodeStateVector,
  encodeUpdate,
  decodeUpdate,
  createSyncStep1,
  createSyncStep2,
  createUpdateMessage,
  parseSyncMessage,
  encodeAwarenessUpdate,
  decodeAwarenessUpdate,
  mergeUpdates,
  computeMissingUpdates,
  computeStateDiff,
  hashClientId,
  YjsSyncMessageType,
} from "../collaboration/yjs-protocol.js"

describe("Binary Encoding Helpers", () => {
  describe("writeVarUint / readVarUint", () => {
    it("encodes and decodes small numbers", () => {
      const encoded = writeVarUint(42)
      const { value, offset } = readVarUint(encoded, 0)
      expect(value).toBe(42)
      expect(offset).toBe(encoded.length)
    })

    it("encodes and decodes zero", () => {
      const encoded = writeVarUint(0)
      const { value } = readVarUint(encoded, 0)
      expect(value).toBe(0)
    })

    it("encodes and decodes large numbers", () => {
      const values = [127, 128, 255, 256, 65535, 1_000_000, 2_147_483_647]
      for (const n of values) {
        const encoded = writeVarUint(n)
        const { value } = readVarUint(encoded, 0)
        expect(value).toBe(n)
      }
    })

    it("uses multi-byte encoding for values > 127", () => {
      expect(writeVarUint(127).length).toBe(1)
      expect(writeVarUint(128).length).toBe(2)
      expect(writeVarUint(16384).length).toBe(3)
    })
  })

  describe("writeVarBytes / readVarBytes", () => {
    it("round-trips byte arrays", () => {
      const original = new Uint8Array([1, 2, 3, 4, 5])
      const encoded = writeVarBytes(original)
      const { data } = readVarBytes(encoded, 0)
      expect(data).toEqual(original)
    })

    it("handles empty arrays", () => {
      const encoded = writeVarBytes(new Uint8Array(0))
      const { data } = readVarBytes(encoded, 0)
      expect(data.length).toBe(0)
    })
  })

  describe("writeVarString / readVarString", () => {
    it("round-trips ASCII strings", () => {
      const encoded = writeVarString("hello world")
      const { value } = readVarString(encoded, 0)
      expect(value).toBe("hello world")
    })

    it("round-trips Unicode strings", () => {
      const encoded = writeVarString("café 🎉 日本語")
      const { value } = readVarString(encoded, 0)
      expect(value).toBe("café 🎉 日本語")
    })

    it("round-trips empty strings", () => {
      const encoded = writeVarString("")
      const { value } = readVarString(encoded, 0)
      expect(value).toBe("")
    })
  })
})

describe("State Vector Encoding", () => {
  it("encodes and decodes a state vector", () => {
    const sv = { "client-1": 5, "client-2": 3 }
    const encoded = encodeStateVector(sv)
    const decoded = decodeStateVector(encoded)

    expect(decoded.size).toBe(2)
    expect(decoded.get(hashClientId("client-1"))).toBe(5)
    expect(decoded.get(hashClientId("client-2"))).toBe(3)
  })

  it("handles empty state vector", () => {
    const encoded = encodeStateVector({})
    const decoded = decodeStateVector(encoded)
    expect(decoded.size).toBe(0)
  })

  it("handles single-client state vector", () => {
    const encoded = encodeStateVector({ solo: 42 })
    const decoded = decodeStateVector(encoded)
    expect(decoded.get(hashClientId("solo"))).toBe(42)
  })
})

describe("Update Encoding", () => {
  it("encodes and decodes an update", () => {
    const content = new Uint8Array([10, 20, 30])
    const encoded = encodeUpdate("client-1", 5, content, 3)
    const decoded = decodeUpdate(encoded)

    expect(decoded.clientId).toBe(hashClientId("client-1"))
    expect(decoded.clock).toBe(5)
    expect(decoded.parentClock).toBe(3)
    expect(decoded.content).toEqual(content)
    expect(decoded.length).toBe(3)
  })

  it("defaults parentClock to 0", () => {
    const encoded = encodeUpdate("c1", 1, new Uint8Array([1]))
    const decoded = decodeUpdate(encoded)
    expect(decoded.parentClock).toBe(0)
  })
})

describe("Sync Protocol Messages", () => {
  it("creates and parses SyncStep1", () => {
    const msg = createSyncStep1({ c1: 5, c2: 3 })
    expect(msg.type).toBe(YjsSyncMessageType.SyncStep1)
    expect(msg.data[0]).toBe(YjsSyncMessageType.SyncStep1)

    const parsed = parseSyncMessage(msg.data)
    expect(parsed.type).toBe(YjsSyncMessageType.SyncStep1)
  })

  it("creates and parses SyncStep2", () => {
    const update1 = encodeUpdate("c1", 1, new Uint8Array([1]))
    const update2 = encodeUpdate("c2", 1, new Uint8Array([2]))
    const msg = createSyncStep2([update1, update2])

    expect(msg.type).toBe(YjsSyncMessageType.SyncStep2)
    expect(msg.data[0]).toBe(YjsSyncMessageType.SyncStep2)
  })

  it("creates incremental update messages", () => {
    const update = encodeUpdate("c1", 3, new Uint8Array([42]))
    const msg = createUpdateMessage(update)

    expect(msg.type).toBe(YjsSyncMessageType.Update)
    expect(msg.data[0]).toBe(YjsSyncMessageType.Update)
  })
})

describe("Awareness Protocol", () => {
  it("encodes and decodes awareness updates", () => {
    const clients = [
      { clientId: 1, clock: 5, state: { cursor: { index: 10, length: 0 }, user: "Alice" } },
      { clientId: 2, clock: 3, state: { cursor: { index: 20, length: 5 }, user: "Bob" } },
    ]

    const encoded = encodeAwarenessUpdate(clients)
    const decoded = decodeAwarenessUpdate(encoded)

    expect(decoded).toHaveLength(2)
    expect(decoded[0].clientId).toBe(1)
    expect(decoded[0].clock).toBe(5)
    expect((decoded[0].state as Record<string, unknown>).user).toBe("Alice")
    expect(decoded[1].clientId).toBe(2)
    expect(((decoded[1].state as Record<string, unknown>).cursor as Record<string, unknown>).index).toBe(20)
  })

  it("handles null state (client disconnected)", () => {
    const clients = [{ clientId: 1, clock: 0, state: null }]
    const encoded = encodeAwarenessUpdate(clients)
    const decoded = decodeAwarenessUpdate(encoded)

    expect(decoded[0].state).toBeNull()
  })
})

describe("State Merging", () => {
  it("merges updates from multiple clients", () => {
    const update1 = encodeUpdate("client-a", 1, new Uint8Array([10, 20]))
    const update2 = encodeUpdate("client-b", 1, new Uint8Array([30, 40]))
    const update3 = encodeUpdate("client-a", 2, new Uint8Array([50]))

    const result = mergeUpdates([update1, update2, update3])
    expect(result.updateCount).toBe(3)
    expect(result.merged.length).toBeGreaterThan(0)
  })

  it("deduplicates updates with same client+clock", () => {
    const update1 = encodeUpdate("client-a", 1, new Uint8Array([10]))
    const update2 = encodeUpdate("client-a", 1, new Uint8Array([20])) // duplicate clock

    const result = mergeUpdates([update1, update2])
    // Only one should be included (first one at clock 1)
    expect(result.updateCount).toBe(1)
  })

  it("orders updates by clock", () => {
    const update3 = encodeUpdate("c1", 3, new Uint8Array([30]))
    const update1 = encodeUpdate("c1", 1, new Uint8Array([10]))
    const update2 = encodeUpdate("c1", 2, new Uint8Array([20]))

    const result = mergeUpdates([update3, update1, update2])
    expect(result.updateCount).toBe(3)
    // State vector should reflect highest clock
    expect(result.stateVector[String(hashClientId("c1"))]).toBe(3)
  })
})

describe("computeMissingUpdates", () => {
  it("finds updates missing from remote", () => {
    const updates = [
      encodeUpdate("c1", 1, new Uint8Array([1])),
      encodeUpdate("c1", 2, new Uint8Array([2])),
      encodeUpdate("c1", 3, new Uint8Array([3])),
    ]

    const remoteSV = new Map<number, number>()
    remoteSV.set(hashClientId("c1"), 1) // Remote has up to clock 1

    const missing = computeMissingUpdates(updates, remoteSV)
    expect(missing).toHaveLength(2) // Updates at clock 2 and 3
  })

  it("returns all updates when remote has empty state", () => {
    const updates = [encodeUpdate("c1", 1, new Uint8Array([1])), encodeUpdate("c2", 1, new Uint8Array([2]))]

    const missing = computeMissingUpdates(updates, new Map())
    expect(missing).toHaveLength(2)
  })

  it("returns empty when remote is up to date", () => {
    const updates = [encodeUpdate("c1", 1, new Uint8Array([1]))]

    const remoteSV = new Map<number, number>()
    remoteSV.set(hashClientId("c1"), 5) // Remote is ahead

    const missing = computeMissingUpdates(updates, remoteSV)
    expect(missing).toHaveLength(0)
  })
})

describe("computeStateDiff", () => {
  it("identifies missing updates on both sides", () => {
    const local = { c1: 5, c2: 3 }
    const remote = { c1: 3, c2: 5, c3: 2 }

    const diff = computeStateDiff(local, remote)
    expect(diff.missingOnLocal).toContain("c2")
    expect(diff.missingOnLocal).toContain("c3")
    expect(diff.missingOnRemote).toContain("c1")
  })

  it("handles identical state vectors", () => {
    const sv = { c1: 5, c2: 3 }
    const diff = computeStateDiff(sv, sv)
    expect(diff.missingOnLocal).toHaveLength(0)
    expect(diff.missingOnRemote).toHaveLength(0)
  })
})

describe("hashClientId", () => {
  it("produces deterministic numeric IDs", () => {
    const hash1 = hashClientId("client-1")
    const hash2 = hashClientId("client-1")
    expect(hash1).toBe(hash2)
  })

  it("produces different IDs for different clients", () => {
    const hash1 = hashClientId("client-1")
    const hash2 = hashClientId("client-2")
    expect(hash1).not.toBe(hash2)
  })

  it("produces unsigned 32-bit integers", () => {
    const hash = hashClientId("test-client")
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThanOrEqual(0xffffffff)
  })
})

describe("DocumentCollaboration with Yjs merge", () => {
  it("applies updates using Yjs-compatible merging", async () => {
    const { DocumentCollaboration } = await import("../collaboration/document-collaboration.js")
    const engine = new DocumentCollaboration()
    engine.createDocument("doc-1")

    engine.applyUpdate("doc-1", new Uint8Array([1, 2, 3]), "user-1")
    engine.applyUpdate("doc-1", new Uint8Array([4, 5, 6]), "user-2")

    const doc = engine.getDocument("doc-1")!
    expect(doc.state).not.toBeNull()
    expect(doc.state!.length).toBeGreaterThan(0)
    expect(doc.version).toBe(2)
  })
})
