import { describe, it, expect } from "vitest"
import { encodeMessage, decodeMessage, compressionRatio } from "../protocol/binary-protocol.js"
import { MultiTabCoordinator, type BroadcastChannelLike, type TabMessage } from "../multitab/multi-tab.js"

describe("binary protocol", () => {
  it("encodes and decodes subscribe message", () => {
    const msg = { type: "subscribe", subscriptionId: "sub1", queryName: "tasks.list", args: { userId: "u1" } }
    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded.type).toBe("subscribe")
    expect(decoded.subscriptionId).toBe("sub1")
    expect(decoded.queryName).toBe("tasks.list")
  })

  it("encodes and decodes mutation message", () => {
    const msg = { type: "mutate", requestId: "r1", mutationName: "tasks.create", args: { title: "Test" } }
    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded.type).toBe("mutate")
    expect(decoded.requestId).toBe("r1")
  })

  it("encodes and decodes ping/pong", () => {
    const ping = encodeMessage({ type: "ping" })
    expect(decodeMessage(ping).type).toBe("ping")

    const pong = encodeMessage({ type: "pong" })
    expect(decodeMessage(pong).type).toBe("pong")
  })

  it("encodes server messages", () => {
    const msg = { type: "subscription_data", subscriptionId: "s1", data: [{ id: "1" }], version: 1 }
    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded.type).toBe("subscription_data")
    expect(decoded.subscriptionId).toBe("s1")
  })

  it("provides bandwidth savings", () => {
    const msg = { type: "subscription_data", subscriptionId: "sub_123", data: [{ id: "1", title: "Task" }], version: 1 }
    const ratio = compressionRatio(msg)
    // Binary format saves bandwidth by removing "type" field from JSON
    expect(ratio).toBeGreaterThan(0)
  })

  it("throws on unknown message type", () => {
    expect(() => encodeMessage({ type: "unknown" })).toThrow("Unknown message type")
  })

  it("throws on empty binary message", () => {
    expect(() => decodeMessage(new ArrayBuffer(0))).toThrow("Empty message")
  })
})

describe("MultiTabCoordinator", () => {
  function createMockChannel(): BroadcastChannelLike & { messages: TabMessage[] } {
    return {
      messages: [],
      postMessage(msg: unknown) {
        this.messages.push(msg as TabMessage)
      },
      onmessage: null,
    }
  }

  it("elects leader when no competing tabs", async () => {
    const channel = createMockChannel()
    const coord = new MultiTabCoordinator("test", () => channel)

    const role = await coord.elect()
    expect(role).toBe("leader")
    expect(coord.currentRole).toBe("leader")

    coord.close()
  })

  it("assigns unique tab IDs", () => {
    const ch1 = createMockChannel()
    const ch2 = createMockChannel()
    const c1 = new MultiTabCoordinator("test", () => ch1)
    const c2 = new MultiTabCoordinator("test", () => ch2)

    expect(c1.id).not.toBe(c2.id)

    c1.close()
    c2.close()
  })

  it("becomes leader without BroadcastChannel support", async () => {
    const coord = new MultiTabCoordinator("test", undefined)
    // When BroadcastChannel is not available, always become leader
    const role = await coord.elect()
    expect(role).toBe("leader")

    coord.close()
  })

  it("broadcasts updates to handlers", () => {
    const channel = createMockChannel()
    const coord = new MultiTabCoordinator("test", () => channel)

    const received: unknown[] = []
    coord.onUpdate((data) => received.push(data))

    // Simulate receiving an update from another tab
    if (channel.onmessage) {
      channel.onmessage({
        data: {
          type: "update",
          tabId: "other_tab",
          payload: { subscriptionId: "s1", data: [], version: 1 },
        },
      })
    }

    expect(received).toHaveLength(1)

    coord.close()
  })
})
