import { describe, it, expect } from "vitest"
import { parseClientMessage, serializeServerMessage } from "../transport/protocol.js"

describe("protocol", () => {
  it("parses subscribe message", () => {
    const raw = JSON.stringify({
      type: "subscribe",
      subscriptionId: "sub1",
      queryName: "listTasks",
      args: { userId: "u1" },
    })

    const msg = parseClientMessage(raw)
    expect(msg.type).toBe("subscribe")
  })

  it("parses mutate message", () => {
    const raw = JSON.stringify({
      type: "mutate",
      requestId: "mut1",
      mutationName: "createTask",
      args: { title: "Test" },
    })

    const msg = parseClientMessage(raw)
    expect(msg.type).toBe("mutate")
  })

  it("parses ping message", () => {
    const raw = JSON.stringify({ type: "ping" })
    const msg = parseClientMessage(raw)
    expect(msg.type).toBe("ping")
  })

  it("throws on invalid message", () => {
    expect(() => parseClientMessage("not json")).toThrow()
    expect(() => parseClientMessage("{}")).toThrow("missing type")
  })

  it("serializes server message", () => {
    const msg = serializeServerMessage({
      type: "subscription_data",
      subscriptionId: "sub1",
      data: [{ id: "1" }],
      version: 1,
    })

    const parsed = JSON.parse(msg)
    expect(parsed.type).toBe("subscription_data")
    expect(parsed.subscriptionId).toBe("sub1")
    expect(parsed.data).toEqual([{ id: "1" }])
  })
})
