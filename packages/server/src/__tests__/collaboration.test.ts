import { describe, it, expect, vi, beforeEach } from "vitest"
import { CollaborationManager } from "../collaboration/collaboration.js"
import type { RoomAwarenessState } from "../collaboration/collaboration.js"

describe("CollaborationManager", () => {
  let collab: CollaborationManager

  beforeEach(() => {
    collab = new CollaborationManager({ typingTimeoutMs: 100, maxUsersPerRoom: 5 })
  })

  describe("join/leave", () => {
    it("joins a room and assigns a color", () => {
      const awareness = collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      expect(awareness.userId).toBe("u1")
      expect(awareness.userName).toBe("Alice")
      expect(awareness.userColor).toBeDefined()
      expect(awareness.isOnline).toBe(true)
    })

    it("returns existing awareness on duplicate join", () => {
      const first = collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      const second = collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      expect(first).toBe(second)
    })

    it("enforces max users per room", () => {
      for (let i = 0; i < 5; i++) {
        collab.join("room-1", `conn-${i}`, { userId: `u${i}`, userName: `User ${i}` })
      }
      expect(() => collab.join("room-1", "conn-extra", { userId: "extra", userName: "Extra" })).toThrow(
        "maximum of 5 users",
      )
    })

    it("leaves a room", () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.leave("room-1", "conn-1")
      expect(collab.getRoomState("room-1").activeCount).toBe(0)
    })

    it("disconnects from all rooms", () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.join("room-2", "conn-1", { userId: "u1", userName: "Alice" })
      const left = collab.disconnect("conn-1")
      expect(left).toHaveLength(2)
    })
  })

  describe("cursor", () => {
    it("updates cursor position", () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.updateCursor("room-1", "conn-1", { x: 100, y: 200 })

      const cursors = collab.getCursors("room-1")
      expect(cursors).toHaveLength(1)
      expect(cursors[0].cursor).toEqual({ x: 100, y: 200 })
    })

    it("clears cursor", () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.updateCursor("room-1", "conn-1", { x: 100, y: 200 })
      collab.clearCursor("room-1", "conn-1")
      expect(collab.getCursors("room-1")).toHaveLength(0)
    })

    it("returns empty cursors for non-existent room", () => {
      expect(collab.getCursors("nonexistent")).toEqual([])
    })
  })

  describe("selection", () => {
    it("updates selection range", () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.updateSelection("room-1", "conn-1", { field: "title", start: 0, end: 10 })

      const selections = collab.getSelections("room-1")
      expect(selections).toHaveLength(1)
      expect(selections[0].selection.field).toBe("title")
    })

    it("clears selection", () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.updateSelection("room-1", "conn-1", { field: "title", start: 0, end: 10 })
      collab.clearSelection("room-1", "conn-1")
      expect(collab.getSelections("room-1")).toHaveLength(0)
    })
  })

  describe("typing", () => {
    it("sets typing indicator", () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.setTyping("room-1", "conn-1", true)

      const typing = collab.getTypingUsers("room-1")
      expect(typing).toHaveLength(1)
      expect(typing[0].userName).toBe("Alice")
    })

    it("auto-expires typing indicator", async () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.setTyping("room-1", "conn-1", true)

      await new Promise((r) => setTimeout(r, 150))
      expect(collab.getTypingUsers("room-1")).toHaveLength(0)
    })

    it("clears typing on explicit false", () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.setTyping("room-1", "conn-1", true)
      collab.setTyping("room-1", "conn-1", false)
      expect(collab.getTypingUsers("room-1")).toHaveLength(0)
    })
  })

  describe("room state", () => {
    it("returns full room state", () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.join("room-1", "conn-2", { userId: "u2", userName: "Bob" })

      const state = collab.getRoomState("room-1")
      expect(state.users).toHaveLength(2)
      expect(state.activeCount).toBe(2)
    })

    it("lists active rooms", () => {
      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.join("room-2", "conn-2", { userId: "u2", userName: "Bob" })

      const rooms = collab.getActiveRooms()
      expect(rooms).toHaveLength(2)
    })
  })

  describe("listeners", () => {
    it("notifies room listeners on change", () => {
      const received: RoomAwarenessState[] = []
      collab.onAwarenessChange("room-1", (_, state) => received.push(state))

      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      expect(received).toHaveLength(1)
      expect(received[0].users).toHaveLength(1)
    })

    it("notifies global listeners", () => {
      const received: string[] = []
      collab.onAnyChange((roomId) => received.push(roomId))

      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      collab.join("room-2", "conn-2", { userId: "u2", userName: "Bob" })

      expect(received).toEqual(["room-1", "room-2"])
    })

    it("unsubscribes from listeners", () => {
      const received: RoomAwarenessState[] = []
      const unsub = collab.onAwarenessChange("room-1", (_, state) => received.push(state))

      collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
      unsub()
      collab.join("room-1", "conn-2", { userId: "u2", userName: "Bob" })

      expect(received).toHaveLength(1) // Only first join
    })
  })

  it("destroys all state", () => {
    collab.join("room-1", "conn-1", { userId: "u1", userName: "Alice" })
    collab.setTyping("room-1", "conn-1", true)
    collab.destroy()
    expect(collab.getActiveRooms()).toHaveLength(0)
  })
})
