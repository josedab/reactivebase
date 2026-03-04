/**
 * Tests for SessionResumeManager — token persistence, resume handshake,
 * reconnection logic, and handler notifications.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { SessionResumeManager } from "../session/session-resume.js"

// ─── Mock localStorage ──────────────────────────────────────────────────────

function setupMockLocalStorage() {
  const store = new Map<string, string>()
  const mock = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    _store: store,
  }
  Object.defineProperty(globalThis, "localStorage", { value: mock, writable: true, configurable: true })
  return mock
}

function clearMockLocalStorage() {
  try {
    delete (globalThis as Record<string, unknown>).localStorage
  } catch {
    // ignore
  }
}

// ─── SessionResumeManager ────────────────────────────────────────────────────

describe("SessionResumeManager", () => {
  describe("constructor and defaults", () => {
    it("creates with default options", () => {
      const mgr = new SessionResumeManager()
      expect(mgr.getState().token).toBeNull()
      expect(mgr.getState().lastSequence).toBe(0)
      expect(mgr.getState().isResuming).toBe(false)
    })

    it("accepts custom options", () => {
      const mgr = new SessionResumeManager({
        enabled: false,
        resumeTimeoutMs: 10_000,
        storageKey: "custom_key",
      })
      expect(mgr.canResume()).toBe(false)
    })
  })

  describe("token management", () => {
    it("sets and retrieves a session token", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok_123")
      expect(mgr.getState().token).toBe("tok_123")
    })

    it("clears the session token", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok_123")
      mgr.clearToken()
      expect(mgr.getState().token).toBeNull()
      expect(mgr.getState().lastSequence).toBe(0)
    })

    it("overwrites previous token", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok_1")
      mgr.setToken("tok_2")
      expect(mgr.getState().token).toBe("tok_2")
    })
  })

  describe("sequence tracking", () => {
    it("updates last sequence number", () => {
      const mgr = new SessionResumeManager()
      mgr.updateSequence(42)
      expect(mgr.getState().lastSequence).toBe(42)
    })

    it("tracks latest sequence", () => {
      const mgr = new SessionResumeManager()
      mgr.updateSequence(10)
      mgr.updateSequence(20)
      mgr.updateSequence(15)
      expect(mgr.getState().lastSequence).toBe(15)
    })
  })

  describe("canResume", () => {
    it("returns false when no token", () => {
      const mgr = new SessionResumeManager()
      expect(mgr.canResume()).toBe(false)
    })

    it("returns true when enabled and has token", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok_123")
      expect(mgr.canResume()).toBe(true)
    })

    it("returns false when disabled even with token", () => {
      const mgr = new SessionResumeManager({ enabled: false })
      mgr.setToken("tok_123")
      expect(mgr.canResume()).toBe(false)
    })
  })

  describe("buildResumeMessage", () => {
    it("returns null when no token", () => {
      const mgr = new SessionResumeManager()
      expect(mgr.buildResumeMessage()).toBeNull()
    })

    it("returns null when disabled", () => {
      const mgr = new SessionResumeManager({ enabled: false })
      mgr.setToken("tok_123")
      expect(mgr.buildResumeMessage()).toBeNull()
    })

    it("builds resume message with token and sequence", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok_abc")
      mgr.updateSequence(99)

      const msg = mgr.buildResumeMessage()
      expect(msg).toEqual({
        type: "session_resume",
        sessionToken: "tok_abc",
        lastSequence: 99,
      })
    })
  })

  describe("handleResumeResponse — success", () => {
    it("updates token from successful resume", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("old_token")

      mgr.handleResumeResponse({
        success: true,
        sessionToken: "new_token",
        subscriptionCount: 5,
        missedDeltas: [],
      })

      expect(mgr.getState().token).toBe("new_token")
      expect(mgr.getState().isResuming).toBe(false)
    })

    it("updates sequence from missed deltas", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok")

      mgr.handleResumeResponse({
        success: true,
        sessionToken: "tok_new",
        missedDeltas: [
          { subscriptionId: "s1", data: {}, version: 1, sequence: 10 },
          { subscriptionId: "s2", data: {}, version: 2, sequence: 25 },
          { subscriptionId: "s1", data: {}, version: 3, sequence: 15 },
        ],
      })

      expect(mgr.getState().lastSequence).toBe(25) // max sequence
    })

    it("notifies resume handlers on success", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok")

      const handler = vi.fn()
      mgr.onResume(handler)

      mgr.handleResumeResponse({
        success: true,
        sessionToken: "tok_new",
        subscriptionCount: 3,
        missedDeltas: [{ subscriptionId: "s1", data: {}, version: 1, sequence: 5 }],
      })

      expect(handler).toHaveBeenCalledWith({
        success: true,
        restoredSubscriptions: 3,
        missedUpdates: 1,
      })
    })
  })

  describe("handleResumeResponse — failure", () => {
    it("clears token on failed resume", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("old_token")

      mgr.handleResumeResponse({ success: false })

      expect(mgr.getState().token).toBeNull()
      expect(mgr.getState().lastSequence).toBe(0)
    })

    it("notifies handlers on failure", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok")

      const handler = vi.fn()
      mgr.onResume(handler)

      mgr.handleResumeResponse({ success: false })

      expect(handler).toHaveBeenCalledWith({
        success: false,
        restoredSubscriptions: 0,
        missedUpdates: 0,
      })
    })
  })

  describe("onResume handler management", () => {
    it("supports multiple handlers", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok")

      const h1 = vi.fn()
      const h2 = vi.fn()
      mgr.onResume(h1)
      mgr.onResume(h2)

      mgr.handleResumeResponse({ success: true, sessionToken: "new" })

      expect(h1).toHaveBeenCalled()
      expect(h2).toHaveBeenCalled()
    })

    it("returns unsubscribe function", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok")

      const handler = vi.fn()
      const unsub = mgr.onResume(handler)
      unsub()

      mgr.handleResumeResponse({ success: true, sessionToken: "new" })
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe("token persistence with localStorage", () => {
    let mockStorage: ReturnType<typeof setupMockLocalStorage>

    beforeEach(() => {
      mockStorage = setupMockLocalStorage()
    })

    afterEach(() => {
      clearMockLocalStorage()
    })

    it("persists token to localStorage when persistToken is true", () => {
      const mgr = new SessionResumeManager({ persistToken: true })
      mgr.setToken("tok_persist")

      expect(mockStorage.setItem).toHaveBeenCalledWith("reactivebase_session_token", "tok_persist")
    })

    it("loads persisted token on construction", () => {
      mockStorage._store.set("reactivebase_session_token", "restored_token")
      const mgr = new SessionResumeManager({ persistToken: true })

      expect(mgr.getState().token).toBe("restored_token")
    })

    it("uses custom storage key", () => {
      const mgr = new SessionResumeManager({ persistToken: true, storageKey: "my_key" })
      mgr.setToken("tok_custom")

      expect(mockStorage.setItem).toHaveBeenCalledWith("my_key", "tok_custom")
    })

    it("removes token from localStorage on clear", () => {
      const mgr = new SessionResumeManager({ persistToken: true })
      mgr.setToken("tok_clear")
      mgr.clearToken()

      expect(mockStorage.removeItem).toHaveBeenCalledWith("reactivebase_session_token")
    })

    it("does not persist when persistToken is false", () => {
      const mgr = new SessionResumeManager({ persistToken: false })
      mgr.setToken("tok_no_persist")

      expect(mockStorage.setItem).not.toHaveBeenCalled()
    })
  })

  describe("localStorage unavailable", () => {
    it("does not throw when localStorage is undefined", () => {
      clearMockLocalStorage()
      const mgr = new SessionResumeManager({ persistToken: true })
      expect(() => mgr.setToken("tok")).not.toThrow()
      expect(() => mgr.clearToken()).not.toThrow()
    })
  })

  describe("getState returns a copy", () => {
    it("mutations to returned state do not affect internal state", () => {
      const mgr = new SessionResumeManager()
      mgr.setToken("tok")

      const state = mgr.getState()
      ;(state as { token: string | null }).token = "mutated"

      expect(mgr.getState().token).toBe("tok")
    })
  })
})
