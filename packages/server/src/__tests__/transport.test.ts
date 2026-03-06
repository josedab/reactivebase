import { describe, it, expect } from "vitest"
import {
  TransportServer,
  parseClientMessage,
  serializeServerMessage,
  createReactiveBaseMiddleware,
  toExpressMiddleware,
} from "../transport/index.js"

describe("transport", () => {
  it("should export all expected symbols", () => {
    expect(TransportServer).toBeDefined()
    expect(parseClientMessage).toBeDefined()
    expect(serializeServerMessage).toBeDefined()
    expect(createReactiveBaseMiddleware).toBeDefined()
    expect(toExpressMiddleware).toBeDefined()
  })

  it("should parse valid client messages", () => {
    const msg = parseClientMessage(JSON.stringify({ type: "ping", id: "1" }))
    expect(msg).toBeDefined()
    expect(msg.type).toBe("ping")
  })

  it.todo("should test parsing subscribe, unsubscribe, mutate, action, ping, auth messages")

  it("should serialize server messages", () => {
    const serialized = serializeServerMessage({ type: "pong" } as any)
    expect(typeof serialized).toBe("string")
  })

  it.todo("should test serialization of all server message types")
})
