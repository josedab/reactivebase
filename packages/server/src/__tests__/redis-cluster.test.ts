import { describe, it, expect, vi, beforeEach } from "vitest"
import { RedisClusterPubSubAdapter } from "../pubsub/redis-cluster.js"
import type { RedisLike } from "../pubsub/pubsub.js"
import type { ChangeEvent } from "../reactivity/index.js"

function createMockRedisClient(): RedisLike & { _handlers: Map<string, (...args: string[]) => void> } {
  const handlers = new Map<string, (...args: string[]) => void>()
  return {
    _handlers: handlers,
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, handler: (...args: string[]) => void) => {
      handlers.set(event, handler)
    }),
    quit: vi.fn().mockResolvedValue(undefined),
  }
}

const TEST_NODES = [
  { host: "node1.redis.local", port: 6379 },
  { host: "node2.redis.local", port: 6379 },
  { host: "node3.redis.local", port: 6379 },
]

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

describe("RedisClusterPubSubAdapter", () => {
  let mockClient: ReturnType<typeof createMockRedisClient>

  beforeEach(() => {
    mockClient = createMockRedisClient()
  })

  it("requires at least one seed node", () => {
    expect(() => new RedisClusterPubSubAdapter(() => mockClient, { nodes: [], ...silentOpts() })).toThrow(
      "at least one seed node",
    )
  })

  it("publishes messages with serverId", async () => {
    const adapter = createAdapter()
    const events: ChangeEvent[] = [{ table: "tasks", operation: "insert", affectedFilters: {} }]

    await adapter.publish("changes", events)

    expect(mockClient.publish).toHaveBeenCalledTimes(1)
    const [channel, message] = vi.mocked(mockClient.publish).mock.calls[0]
    expect(channel).toBe("changes")
    const parsed = JSON.parse(message)
    expect(parsed.serverId).toBeTruthy()
    expect(parsed.events).toEqual(events)
    expect(parsed.timestamp).toBeGreaterThan(0)
  })

  it("subscribes and receives messages from other servers", async () => {
    const adapter = createAdapter()
    const received: ChangeEvent[][] = []

    await adapter.subscribe("changes", (events) => received.push(events))

    // Simulate a message from another server
    const messageHandler = mockClient._handlers.get("message")
    expect(messageHandler).toBeDefined()

    messageHandler!(
      "changes",
      JSON.stringify({
        serverId: "other_server",
        events: [{ table: "users", operation: "update", affectedFilters: {} }],
      }),
    )

    expect(received).toHaveLength(1)
    expect(received[0][0].table).toBe("users")
  })

  it("ignores messages from self", async () => {
    // Use a stable mock for this test
    const stableMock = createMockRedisClient()
    const adapter = new RedisClusterPubSubAdapter(() => stableMock, { nodes: TEST_NODES, ...silentOpts() })
    const received: ChangeEvent[][] = []

    await adapter.subscribe("changes", (events) => received.push(events))
    await adapter.publish("changes", [{ table: "tasks", operation: "insert", affectedFilters: {} }])

    // Extract serverId from the publish call
    const publishCall = vi.mocked(stableMock.publish).mock.calls[0][1]
    const selfServerId = JSON.parse(publishCall).serverId

    const messageHandler = stableMock._handlers.get("message")
    messageHandler!(
      "changes",
      JSON.stringify({
        serverId: selfServerId,
        events: [{ table: "tasks", operation: "insert", affectedFilters: {} }],
      }),
    )

    expect(received).toHaveLength(0)
    await adapter.close()
  })

  it("unsubscribes from channels", async () => {
    const adapter = createAdapter()
    await adapter.subscribe("changes", () => {})
    await adapter.unsubscribe("changes")

    expect(mockClient.unsubscribe).toHaveBeenCalledWith("changes")
  })

  it("closes all connections gracefully", async () => {
    const adapter = createAdapter()
    await adapter.publish("ch", [])
    await adapter.subscribe("ch", () => {})

    await adapter.close()

    expect(mockClient.quit).toHaveBeenCalled()
    expect(adapter.getStats().state).toBe("closed")
  })

  it("does not publish or subscribe after close", async () => {
    const adapter = createAdapter()
    await adapter.close()

    await adapter.publish("ch", [])
    await adapter.subscribe("ch", () => {})

    expect(mockClient.publish).not.toHaveBeenCalled()
  })

  it("tracks publish and receive counts", async () => {
    const adapter = createAdapter()
    await adapter.publish("ch", [{ table: "t", operation: "insert", affectedFilters: {} }])
    await adapter.publish("ch", [{ table: "t", operation: "update", affectedFilters: {} }])

    const stats = adapter.getStats()
    expect(stats.publishCount).toBe(2)
  })

  it("returns healthy nodes initially", () => {
    const adapter = createAdapter()
    const healthy = adapter.getHealthyNodes()
    expect(healthy).toHaveLength(3)
  })

  it("getStats returns cluster state", () => {
    const adapter = createAdapter()
    const stats = adapter.getStats()

    expect(stats.state).toBe("disconnected")
    expect(stats.publishCount).toBe(0)
    expect(stats.receiveCount).toBe(0)
    expect(stats.reconnectAttempts).toBe(0)
    expect(stats.nodeHealth).toHaveLength(3)
  })

  it("starts and stops health checks", () => {
    const adapter = createAdapter()
    adapter.startHealthChecks()
    adapter.startHealthChecks() // idempotent
    adapter.stopHealthChecks()
  })

  it("handles malformed messages gracefully", async () => {
    const adapter = createAdapter()
    const received: ChangeEvent[][] = []
    await adapter.subscribe("ch", (events) => received.push(events))

    const handler = mockClient._handlers.get("message")
    handler!("ch", "not valid json")

    expect(received).toHaveLength(0) // No crash, no delivery
  })

  function createAdapter() {
    return new RedisClusterPubSubAdapter(
      () => {
        mockClient = createMockRedisClient()
        return mockClient
      },
      { nodes: TEST_NODES, ...silentOpts() },
    )
  }

  function silentOpts() {
    return { logger: silentLogger }
  }
})
