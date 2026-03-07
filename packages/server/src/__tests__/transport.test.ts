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

  it("should test parsing subscribe, unsubscribe, mutate, action, ping, auth messages", () => {
    const subscribe = parseClientMessage(JSON.stringify({ type: "subscribe", subscriptionId: "s1", queryName: "getUsers", args: {} }))
    expect(subscribe.type).toBe("subscribe")

    const unsubscribe = parseClientMessage(JSON.stringify({ type: "unsubscribe", subscriptionId: "s1" }))
    expect(unsubscribe.type).toBe("unsubscribe")

    const mutate = parseClientMessage(JSON.stringify({ type: "mutate", requestId: "r1", mutationName: "createUser", args: { name: "Alice" } }))
    expect(mutate.type).toBe("mutate")

    const action = parseClientMessage(JSON.stringify({ type: "action", requestId: "r2", actionName: "sendEmail", args: {} }))
    expect(action.type).toBe("action")

    const ping = parseClientMessage(JSON.stringify({ type: "ping" }))
    expect(ping.type).toBe("ping")

    const auth = parseClientMessage(JSON.stringify({ type: "auth", token: "jwt-token-123" }))
    expect(auth.type).toBe("auth")
  })

  it("should serialize server messages", () => {
    const serialized = serializeServerMessage({ type: "pong" } as any)
    expect(typeof serialized).toBe("string")
  })

  it("should test serialization of all server message types", () => {
    const pong = serializeServerMessage({ type: "pong" })
    expect(JSON.parse(pong).type).toBe("pong")

    const subData = serializeServerMessage({ type: "subscription_data", subscriptionId: "s1", data: [{ id: 1 }], version: 1 })
    const parsedSubData = JSON.parse(subData)
    expect(parsedSubData.type).toBe("subscription_data")
    expect(parsedSubData.subscriptionId).toBe("s1")
    expect(parsedSubData.version).toBe(1)

    const subUpdate = serializeServerMessage({ type: "subscription_update", subscriptionId: "s2", data: { updated: true }, version: 2 })
    expect(JSON.parse(subUpdate).type).toBe("subscription_update")

    const mutResult = serializeServerMessage({ type: "mutation_result", requestId: "r1", data: { id: 1 } })
    expect(JSON.parse(mutResult).type).toBe("mutation_result")

    const mutError = serializeServerMessage({ type: "mutation_error", requestId: "r1", error: { code: "INVALID", message: "bad" } })
    expect(JSON.parse(mutError).type).toBe("mutation_error")

    const actionResult = serializeServerMessage({ type: "action_result", requestId: "r2", data: "ok" })
    expect(JSON.parse(actionResult).type).toBe("action_result")

    const actionError = serializeServerMessage({ type: "action_error", requestId: "r2", error: { code: "FAIL", message: "err" } })
    expect(JSON.parse(actionError).type).toBe("action_error")

    const authResult = serializeServerMessage({ type: "auth_result", success: true })
    expect(JSON.parse(authResult).type).toBe("auth_result")
    expect(JSON.parse(authResult).success).toBe(true)
  })
})
