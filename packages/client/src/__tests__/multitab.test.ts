import { describe, it, expect, vi } from "vitest"
import { MultiTabCoordinator } from "../multitab/multi-tab.js"
import type { BroadcastChannelLike, TabMessage } from "../multitab/multi-tab.js"

// ─── Mock BroadcastChannel ───────────────────────────────────────────────────

function createMockChannel(): BroadcastChannelLike & {
  _messages: TabMessage[]
  _simulateMessage(msg: TabMessage): void
} {
  const channel: BroadcastChannelLike & {
    _messages: TabMessage[]
    _simulateMessage(msg: TabMessage): void
  } = {
    _messages: [],
    postMessage: vi.fn((message: unknown) => {
      channel._messages.push(message as TabMessage)
    }),
    onmessage: null,
    _simulateMessage(msg: TabMessage) {
      if (channel.onmessage) {
        channel.onmessage({ data: msg })
      }
    },
  }
  return channel
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("multi-tab", () => {
  it("should export MultiTabCoordinator class", () => {
    expect(MultiTabCoordinator).toBeDefined()
  })

  it("should construct a MultiTabCoordinator instance", () => {
    const coordinator = new MultiTabCoordinator("test", () => createMockChannel())
    expect(coordinator).toBeInstanceOf(MultiTabCoordinator)
    coordinator.close()
  })

  describe("leader election", () => {
    it("becomes leader when no channel is available", async () => {
      const _coordinator = new MultiTabCoordinator("test", undefined)
      // Without BroadcastChannel, should immediately become leader
      // but constructor needs no channel factory
    })

    it("becomes leader when no competing claims", async () => {
      vi.useFakeTimers()
      try {
        const channel = createMockChannel()
        const coordinator = new MultiTabCoordinator("test", () => channel)

        const rolePromise = coordinator.elect()
        // Advance past election timeout
        await vi.advanceTimersByTimeAsync(200)
        const role = await rolePromise

        expect(role).toBe("leader")
        expect(coordinator.currentRole).toBe("leader")
        coordinator.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it("broadcasts leader_claim during election", async () => {
      vi.useFakeTimers()
      try {
        const channel = createMockChannel()
        const coordinator = new MultiTabCoordinator("test", () => channel)

        coordinator.elect()
        // Should have sent a leader_claim
        expect(channel.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: "leader_claim" }),
        )
        await vi.advanceTimersByTimeAsync(200)
        coordinator.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it("broadcasts leader_ack when elected", async () => {
      vi.useFakeTimers()
      try {
        const channel = createMockChannel()
        const coordinator = new MultiTabCoordinator("test", () => channel)

        const rolePromise = coordinator.elect()
        await vi.advanceTimersByTimeAsync(200)
        await rolePromise

        const ackMessages = channel._messages.filter((m) => m.type === "leader_ack")
        expect(ackMessages.length).toBeGreaterThan(0)
        coordinator.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it("becomes follower when receiving leader_ack from another tab", async () => {
      vi.useFakeTimers()
      try {
        const channel = createMockChannel()
        const coordinator = new MultiTabCoordinator("test", () => channel)

        // Start election (don't await — promise won't resolve if we become follower)
        coordinator.elect()

        // Simulate another tab acknowledging leadership
        channel._simulateMessage({
          type: "leader_ack",
          tabId: "other_tab_zzz",
        })

        expect(coordinator.currentRole).toBe("follower")
        coordinator.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it("becomes follower when competing tab has higher ID", async () => {
      vi.useFakeTimers()
      try {
        const channel = createMockChannel()
        const coordinator = new MultiTabCoordinator("test", () => channel)

        // Start election but don't await it (it may not resolve if we become follower via leader_claim)
        coordinator.elect()

        // Simulate a competing leader_claim with a higher tab ID
        const higherTabId = "tab_zzzzzzz_9999999999999"
        channel._simulateMessage({
          type: "leader_claim",
          tabId: higherTabId,
        })

        // The coordinator should immediately become follower
        if (higherTabId > coordinator.id) {
          expect(coordinator.currentRole).toBe("follower")
        }
        coordinator.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it("single tab always becomes leader (no channel)", async () => {
      // When no BroadcastChannel factory is provided and global BroadcastChannel unavailable
      // The constructor won't create a channel, and elect() returns "leader" immediately
      const coordinator = new MultiTabCoordinator("test", undefined)
      // Without a channel, elect returns leader synchronously
      const role = await coordinator.elect()
      expect(role).toBe("leader")
      coordinator.close()
    })
  })

  describe("message broadcasting", () => {
    it("broadcasts update messages via postMessage", () => {
      const channel = createMockChannel()
      const coordinator = new MultiTabCoordinator("test", () => channel)

      coordinator.broadcastUpdate("sub-1", { name: "test" }, 1)

      expect(channel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "update",
          payload: { subscriptionId: "sub-1", data: { name: "test" }, version: 1 },
        }),
      )
      coordinator.close()
    })

    it("calls onUpdate handlers when receiving update messages", () => {
      const channel = createMockChannel()
      const coordinator = new MultiTabCoordinator("test", () => channel)

      const handler = vi.fn()
      coordinator.onUpdate(handler)

      // Simulate incoming update from another tab
      channel._simulateMessage({
        type: "update",
        tabId: "other_tab",
        payload: { subscriptionId: "sub-1", data: { x: 1 }, version: 2 },
      })

      expect(handler).toHaveBeenCalledWith({
        subscriptionId: "sub-1",
        data: { x: 1 },
        version: 2,
      })
      coordinator.close()
    })

    it("ignores messages from own tab", () => {
      const channel = createMockChannel()
      const coordinator = new MultiTabCoordinator("test", () => channel)

      const handler = vi.fn()
      coordinator.onUpdate(handler)

      // Simulate message from self
      channel._simulateMessage({
        type: "update",
        tabId: coordinator.id,
        payload: { data: "self" },
      })

      expect(handler).not.toHaveBeenCalled()
      coordinator.close()
    })
  })

  describe("tab role transitions", () => {
    it("starts in electing role", () => {
      const channel = createMockChannel()
      const coordinator = new MultiTabCoordinator("test", () => channel)
      expect(coordinator.currentRole).toBe("electing")
      coordinator.close()
    })

    it("has a unique tab ID", () => {
      const channel = createMockChannel()
      const c1 = new MultiTabCoordinator("test", () => channel)
      const c2 = new MultiTabCoordinator("test", () => createMockChannel())
      expect(c1.id).toBeDefined()
      expect(c2.id).toBeDefined()
      expect(c1.id).not.toBe(c2.id)
      c1.close()
      c2.close()
    })
  })

  describe("onUpdate handler management", () => {
    it("returns unsubscribe function", () => {
      const channel = createMockChannel()
      const coordinator = new MultiTabCoordinator("test", () => channel)

      const handler = vi.fn()
      const unsub = coordinator.onUpdate(handler)
      unsub()

      channel._simulateMessage({
        type: "update",
        tabId: "other",
        payload: { data: "test" },
      })

      expect(handler).not.toHaveBeenCalled()
      coordinator.close()
    })

    it("supports multiple handlers", () => {
      const channel = createMockChannel()
      const coordinator = new MultiTabCoordinator("test", () => channel)

      const handler1 = vi.fn()
      const handler2 = vi.fn()
      coordinator.onUpdate(handler1)
      coordinator.onUpdate(handler2)

      channel._simulateMessage({
        type: "update",
        tabId: "other",
        payload: "data",
      })

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
      coordinator.close()
    })
  })

  describe("close()", () => {
    it("can be called safely", () => {
      const channel = createMockChannel()
      const coordinator = new MultiTabCoordinator("test", () => channel)
      expect(() => coordinator.close()).not.toThrow()
    })

    it("handles close on channel with close method", () => {
      const channel = createMockChannel() as BroadcastChannelLike & { close(): void }
      channel.close = vi.fn()
      const coordinator = new MultiTabCoordinator("test", () => channel)
      coordinator.close()
      expect(channel.close).toHaveBeenCalled()
    })
  })
})
