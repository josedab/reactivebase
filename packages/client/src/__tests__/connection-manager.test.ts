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

  it.todo("should test connection lifecycle (connect, disconnect, reconnect)")
  it.todo("should test message handling and status transitions")
})
