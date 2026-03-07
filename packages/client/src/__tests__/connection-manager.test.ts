import { describe, it, expect } from "vitest"
import { ConnectionManager } from "../connection/connection-manager.js"
import type { ConnectionOptions } from "../connection/connection-manager.js"

describe("connection-manager", () => {
  it("should export ConnectionManager class", () => {
    expect(ConnectionManager).toBeDefined()
  })

  it("should construct a ConnectionManager instance", () => {
    const options: ConnectionOptions = {
      url: "ws://localhost:3000",
      maxReconnectAttempts: 3,
      reconnectBaseDelay: 100,
      reconnectMaxDelay: 5000,
      heartbeatInterval: 30000,
    }
    const manager = new ConnectionManager(options)
    expect(manager).toBeInstanceOf(ConnectionManager)
  })

  it("should start in disconnected status", () => {
    const manager = new ConnectionManager({ url: "ws://localhost:3000" })
    expect(manager.getStatus()).toBe("disconnected")
  })

  it("should register and unregister message handlers", () => {
    const manager = new ConnectionManager({ url: "ws://localhost:3000" })
    const handler = () => {}
    const unsub = manager.onMessage(handler)
    expect(typeof unsub).toBe("function")
    unsub()
  })

  it("should register and unregister status handlers", () => {
    const manager = new ConnectionManager({ url: "ws://localhost:3000" })
    const statuses: string[] = []
    const unsub = manager.onStatus((s) => statuses.push(s))
    expect(typeof unsub).toBe("function")
    unsub()
  })

  it("should queue messages when not connected", () => {
    const manager = new ConnectionManager({ url: "ws://localhost:3000" })
    // Sending while disconnected should not throw
    expect(() => manager.send({ type: "subscribe", query: "test" })).not.toThrow()
  })

  it("should handle disconnect when not connected", () => {
    const manager = new ConnectionManager({ url: "ws://localhost:3000" })
    expect(() => manager.disconnect()).not.toThrow()
    expect(manager.getStatus()).toBe("disconnected")
  })

  it("should use default options when none provided", () => {
    const manager = new ConnectionManager()
    expect(manager).toBeInstanceOf(ConnectionManager)
    expect(manager.getStatus()).toBe("disconnected")
  })
})
