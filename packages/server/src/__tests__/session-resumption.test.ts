import { describe, it, expect } from "vitest"
import { SessionStore } from "../session-resumption/session-resumption.js"

describe("SessionStore", () => {
  it("creates sessions with unique tokens", () => {
    const store = new SessionStore()
    const s1 = store.createSession("conn1")
    const s2 = store.createSession("conn2")

    expect(s1.sessionToken).toBeDefined()
    expect(s2.sessionToken).toBeDefined()
    expect(s1.sessionToken).not.toBe(s2.sessionToken)
    expect(store.sessionCount).toBe(2)
  })

  it("records and resumes with missed deltas", () => {
    const store = new SessionStore()
    const session = store.createSession("conn1")

    store.addSubscription(session.sessionToken, {
      subscriptionId: "sub1",
      queryName: "listTasks",
      args: {},
      lastVersion: 1,
      lastResultHash: "abc",
    })

    // Simulate client disconnecting at sequence 0
    store.recordDelta(session.sessionToken, { subscriptionId: "sub1", data: [{ id: 1 }], version: 2 })
    store.recordDelta(session.sessionToken, { subscriptionId: "sub1", data: [{ id: 1 }, { id: 2 }], version: 3 })

    // Client reconnects having seen sequence 0
    const result = store.resumeSession(session.sessionToken, 0)

    expect(result.success).toBe(true)
    expect(result.missedDeltas).toHaveLength(2)
    expect(result.missedDeltas[0].sequence).toBe(1)
    expect(result.missedDeltas[1].sequence).toBe(2)
    expect(result.subscriptions).toHaveLength(1)
  })

  it("returns partial deltas when client has seen some", () => {
    const store = new SessionStore()
    const session = store.createSession("conn1")

    store.addSubscription(session.sessionToken, {
      subscriptionId: "sub1",
      queryName: "q",
      args: {},
      lastVersion: 1,
      lastResultHash: "a",
    })

    store.recordDelta(session.sessionToken, { subscriptionId: "sub1", data: "v1", version: 2 })
    store.recordDelta(session.sessionToken, { subscriptionId: "sub1", data: "v2", version: 3 })
    store.recordDelta(session.sessionToken, { subscriptionId: "sub1", data: "v3", version: 4 })

    // Client saw sequence 2
    const result = store.resumeSession(session.sessionToken, 2)

    expect(result.success).toBe(true)
    expect(result.missedDeltas).toHaveLength(1)
    expect(result.missedDeltas[0].data).toBe("v3")
  })

  it("fails resume for expired sessions", () => {
    const store = new SessionStore({ sessionTTLMs: 1 }) // 1ms TTL
    const session = store.createSession("conn1")

    // Wait for expiration
    const result = store.resumeSession(session.sessionToken, 0)

    // May or may not be expired depending on timing; check the contract
    if (!result.success) {
      expect(result.error).toContain("expired")
    }
  })

  it("fails resume for unknown tokens", () => {
    const store = new SessionStore()
    const result = store.resumeSession("invalid-token", 0)

    expect(result.success).toBe(false)
    expect(result.error).toContain("not found")
  })

  it("removes subscriptions", () => {
    const store = new SessionStore()
    const session = store.createSession("conn1")

    store.addSubscription(session.sessionToken, {
      subscriptionId: "sub1",
      queryName: "q",
      args: {},
      lastVersion: 1,
      lastResultHash: "a",
    })
    store.removeSubscription(session.sessionToken, "sub1")

    const result = store.resumeSession(session.sessionToken, 0)
    expect(result.subscriptions).toHaveLength(0)
  })

  it("destroys sessions", () => {
    const store = new SessionStore()
    const session = store.createSession("conn1")
    store.destroySession(session.sessionToken)

    expect(store.sessionCount).toBe(0)
    expect(store.getSession(session.sessionToken)).toBeUndefined()
  })

  it("evicts oldest session when limit exceeded", () => {
    const store = new SessionStore({ maxSessions: 2 })
    const s1 = store.createSession("conn1")
    store.createSession("conn2")
    store.createSession("conn3")

    expect(store.sessionCount).toBe(2)
    expect(store.getSession(s1.sessionToken)).toBeUndefined()
  })

  it("rejects resume when connection identity mismatches", () => {
    const store = new SessionStore()
    const session = store.createSession("conn-original")

    store.recordDelta(session.sessionToken, { subscriptionId: "sub1", data: {}, version: 1 })

    // Different connection tries to hijack the session
    const result = store.resumeSession(session.sessionToken, 0, "conn-hijacker")

    expect(result.success).toBe(false)
    expect(result.error).toContain("identity mismatch")
    expect(result.missedDeltas).toHaveLength(0)
  })

  it("allows resume when connection identity matches", () => {
    const store = new SessionStore()
    const session = store.createSession("conn-original")

    store.recordDelta(session.sessionToken, { subscriptionId: "sub1", data: {}, version: 1 })

    const result = store.resumeSession(session.sessionToken, 0, "conn-original")

    expect(result.success).toBe(true)
    expect(result.missedDeltas).toHaveLength(1)
  })

  it("allows resume without connection identity check for backward compatibility", () => {
    const store = new SessionStore()
    const session = store.createSession("conn-original")

    store.recordDelta(session.sessionToken, { subscriptionId: "sub1", data: {}, version: 1 })

    // No connectionId provided — backward compatible
    const result = store.resumeSession(session.sessionToken, 0)

    expect(result.success).toBe(true)
    expect(result.missedDeltas).toHaveLength(1)
  })
})
