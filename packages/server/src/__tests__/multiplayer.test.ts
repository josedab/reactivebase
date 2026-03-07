import { describe, it, expect } from "vitest"
import {
  MultiplayerKit,
  CrdtDocument,
  PresenceTracker,
  CursorManager,
  MultiplayerError,
  incrementVectorClock,
  mergeVectorClocks,
  buildCreateMultiplayerTablesSQL,
} from "../multiplayer/index.js"

describe("multiplayer", () => {
  it("should export all expected symbols", () => {
    expect(MultiplayerKit).toBeDefined()
    expect(CrdtDocument).toBeDefined()
    expect(PresenceTracker).toBeDefined()
    expect(CursorManager).toBeDefined()
    expect(MultiplayerError).toBeDefined()
    expect(incrementVectorClock).toBeDefined()
    expect(mergeVectorClocks).toBeDefined()
  })

  it("should increment vector clock for a node", () => {
    const clock = { node1: 1 }
    const updated = incrementVectorClock(clock, "node1")
    expect(updated.node1).toBe(2)
  })

  it("should test vector clock merge conflict resolution", () => {
    const clockA = { node1: 3, node2: 1 }
    const clockB = { node1: 1, node2: 4, node3: 2 }
    const merged = mergeVectorClocks(clockA, clockB)

    expect(merged.node1).toBe(3) // max(3, 1)
    expect(merged.node2).toBe(4) // max(1, 4)
    expect(merged.node3).toBe(2) // max(0, 2)

    // Merging with empty clock should return the original
    const mergedEmpty = mergeVectorClocks(clockA, {})
    expect(mergedEmpty).toEqual(clockA)

    // Merging two identical clocks
    const mergedSame = mergeVectorClocks(clockA, clockA)
    expect(mergedSame).toEqual(clockA)
  })

  it("should generate valid multiplayer tables SQL", () => {
    const sql = buildCreateMultiplayerTablesSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })

  it("should test SQL contains room and operation tables", () => {
    const sql = buildCreateMultiplayerTablesSQL()
    const upper = sql.toUpperCase()
    expect(upper).toContain("_RB_MP_ROOMS")
    expect(upper).toContain("_RB_MP_PERMISSIONS")
    expect(upper).toContain("_RB_MP_OPERATIONS")
    expect(upper).toContain("ROOM_ID")
    expect(upper).toContain("DOCUMENT_ID")
    expect(upper).toContain("USER_ID")
    expect(upper).toContain("INDEX")
  })
})
