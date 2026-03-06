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
    // TODO: test vector clock merge conflict resolution
    const clock = { node1: 1 }
    const updated = incrementVectorClock(clock, "node1")
    expect(updated.node1).toBe(2)
  })

  it("should generate valid multiplayer tables SQL", () => {
    // TODO: test SQL contains room and operation tables
    const sql = buildCreateMultiplayerTablesSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })
})
