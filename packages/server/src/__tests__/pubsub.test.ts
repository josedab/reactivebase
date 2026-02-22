import { describe, it, expect, beforeEach } from "vitest"
import { InMemoryPubSubAdapter } from "../pubsub/pubsub.js"
import type { ChangeEvent } from "../reactivity/index.js"

describe("InMemoryPubSubAdapter", () => {
  beforeEach(() => {
    InMemoryPubSubAdapter.reset()
  })

  it("delivers messages between adapters", async () => {
    const adapter1 = new InMemoryPubSubAdapter()
    const adapter2 = new InMemoryPubSubAdapter()

    const received: ChangeEvent[][] = []
    await adapter2.subscribe("test-channel", (events) => received.push(events))

    const changes: ChangeEvent[] = [
      { table: "tasks", operation: "insert" },
    ]
    await adapter1.publish("test-channel", changes)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(changes)
  })

  it("does not deliver messages to sender", async () => {
    const adapter = new InMemoryPubSubAdapter()
    const received: ChangeEvent[][] = []

    await adapter.subscribe("test-channel", (events) => received.push(events))
    await adapter.publish("test-channel", [{ table: "tasks", operation: "update" }])

    expect(received).toHaveLength(0)
  })

  it("supports multiple subscribers", async () => {
    const publisher = new InMemoryPubSubAdapter()
    const sub1 = new InMemoryPubSubAdapter()
    const sub2 = new InMemoryPubSubAdapter()

    const received1: ChangeEvent[][] = []
    const received2: ChangeEvent[][] = []

    await sub1.subscribe("ch", (events) => received1.push(events))
    await sub2.subscribe("ch", (events) => received2.push(events))

    await publisher.publish("ch", [{ table: "users", operation: "delete" }])

    expect(received1).toHaveLength(1)
    expect(received2).toHaveLength(1)
  })

  it("stops receiving after unsubscribe", async () => {
    const publisher = new InMemoryPubSubAdapter()
    const subscriber = new InMemoryPubSubAdapter()

    const received: ChangeEvent[][] = []
    await subscriber.subscribe("ch", (events) => received.push(events))

    await publisher.publish("ch", [{ table: "tasks", operation: "insert" }])
    expect(received).toHaveLength(1)

    await subscriber.unsubscribe("ch")
    await publisher.publish("ch", [{ table: "tasks", operation: "insert" }])
    expect(received).toHaveLength(1)
  })

  it("cleans up on close", async () => {
    const publisher = new InMemoryPubSubAdapter()
    const subscriber = new InMemoryPubSubAdapter()

    const received: ChangeEvent[][] = []
    await subscriber.subscribe("ch", (events) => received.push(events))

    await subscriber.close()
    await publisher.publish("ch", [{ table: "tasks", operation: "insert" }])
    expect(received).toHaveLength(0)
  })
})
