import { describe, it, expect, beforeEach } from "vitest"
import {
  PresenceManager,
  buildIncrementSQL,
  buildArrayAppendSQL,
  buildArrayRemoveSQL,
  buildJsonMergeSQL,
} from "../presence/presence.js"

describe("PresenceManager", () => {
  let presence: PresenceManager

  beforeEach(() => {
    presence = new PresenceManager({ ttl: 5000 })
  })

  it("sets and gets presence for a room", () => {
    presence.set("room-1", "conn-1", { cursor: { x: 10, y: 20 } }, "user-1")
    presence.set("room-1", "conn-2", { cursor: { x: 30, y: 40 } }, "user-2")

    const room = presence.getRoom("room-1")
    expect(room).toHaveLength(2)
    expect(room[0].data.cursor).toEqual({ x: 10, y: 20 })
    expect(room[1].userId).toBe("user-2")
  })

  it("updates presence for same connection", () => {
    presence.set("room-1", "conn-1", { cursor: { x: 0, y: 0 } })
    presence.set("room-1", "conn-1", { cursor: { x: 100, y: 200 } })

    const room = presence.getRoom("room-1")
    expect(room).toHaveLength(1)
    expect(room[0].data.cursor).toEqual({ x: 100, y: 200 })
  })

  it("removes connection from all rooms", () => {
    presence.set("room-1", "conn-1", { active: true })
    presence.set("room-2", "conn-1", { active: true })
    presence.set("room-1", "conn-2", { active: true })

    presence.removeConnection("conn-1")

    expect(presence.getRoom("room-1")).toHaveLength(1)
    expect(presence.getRoom("room-2")).toHaveLength(0)
  })

  it("leaves a specific room", () => {
    presence.set("room-1", "conn-1", { active: true })
    presence.set("room-2", "conn-1", { active: true })

    presence.leave("room-1", "conn-1")

    expect(presence.getRoom("room-1")).toHaveLength(0)
    expect(presence.getRoom("room-2")).toHaveLength(1)
  })

  it("notifies listeners on presence change", () => {
    const updates: Array<{ roomId: string; count: number }> = []
    presence.onUpdate((roomId, list) => {
      updates.push({ roomId, count: list.length })
    })

    presence.set("room-1", "conn-1", { active: true })
    presence.set("room-1", "conn-2", { active: true })

    expect(updates).toHaveLength(2)
    expect(updates[1].count).toBe(2)
  })

  it("removes expired presence entries", async () => {
    const mgr = new PresenceManager({ ttl: 1 })
    mgr.set("room-1", "conn-1", { active: true })

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 10))
    const room = mgr.getRoom("room-1")
    expect(room).toHaveLength(0)
  })

  it("tracks room count and total presence", () => {
    presence.set("room-1", "conn-1", {})
    presence.set("room-2", "conn-2", {})
    presence.set("room-2", "conn-3", {})

    expect(presence.roomCount).toBe(2)
    expect(presence.totalPresence).toBe(3)
  })

  it("cleans up empty rooms", () => {
    presence.set("room-1", "conn-1", {})
    presence.leave("room-1", "conn-1")

    expect(presence.roomCount).toBe(0)
  })

  it("stops and clears all data", () => {
    presence.set("room-1", "conn-1", {})
    presence.startCleanup()
    presence.stop()

    expect(presence.roomCount).toBe(0)
    expect(presence.totalPresence).toBe(0)
  })
})

describe("conflict-free operations", () => {
  it("builds increment SQL", () => {
    const { sql, params } = buildIncrementSQL("tasks", "t1", "votes", 1)
    expect(sql).toContain('"votes" = "votes" + $1')
    expect(params).toEqual([1, "t1"])
  })

  it("builds decrement SQL", () => {
    const { sql, params } = buildIncrementSQL("tasks", "t1", "votes", -1)
    expect(params[0]).toBe(-1)
    expect(sql).toContain("RETURNING *")
  })

  it("builds array append SQL", () => {
    const { sql, params } = buildArrayAppendSQL("tasks", "t1", "tags", "urgent")
    expect(sql).toContain("array_append")
    expect(params).toEqual(["urgent", "t1"])
  })

  it("builds array remove SQL", () => {
    const { sql, params } = buildArrayRemoveSQL("tasks", "t1", "tags", "done")
    expect(sql).toContain("array_remove")
    expect(params).toEqual(["done", "t1"])
  })

  it("builds JSON merge SQL", () => {
    const { sql, params } = buildJsonMergeSQL("users", "u1", "settings", { theme: "dark" })
    expect(sql).toContain("||")
    expect(sql).toContain("::jsonb")
    expect(params[0]).toBe('{"theme":"dark"}')
  })
})
