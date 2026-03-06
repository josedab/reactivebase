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
    // TODO: test parsing subscribe, unsubscribe, mutate, action, ping, auth messages
    const msg = parseClientMessage(JSON.stringify({ type: "ping", id: "1" }))
    expect(msg).toBeDefined()
    expect(msg.type).toBe("ping")
  })

  it("should serialize server messages", () => {
    // TODO: test serialization of all server message types
    const serialized = serializeServerMessage({ type: "pong" } as any)
    expect(typeof serialized).toBe("string")
  })
})
