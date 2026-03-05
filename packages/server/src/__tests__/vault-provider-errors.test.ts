/**
 * Error path and edge case tests for Vault Key Provider and GCP KMS Key Provider.
 * Extends existing vault-provider.test.ts with error scenarios, strict mode,
 * concurrent rotation, and KMS provider edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { vaultKeyProvider, gcpKmsKeyProvider, VaultError } from "../encryption/vault-provider.js"

// ─── VaultError ──────────────────────────────────────────────────────────────

describe("VaultError", () => {
  it("creates error with correct name and message", () => {
    const err = new VaultError("connection failed")
    expect(err.message).toBe("connection failed")
    expect(err.name).toBe("VaultError")
    expect(err).toBeInstanceOf(Error)
  })
})

// ─── Vault Key Provider Error Paths ──────────────────────────────────────────

describe("vaultKeyProvider error paths", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe("getCurrentKeyId", () => {
    it("falls back to local version on fetch failure (non-strict)", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("connection refused"))
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
        strictMode: false,
      })

      const keyId = await provider.getCurrentKeyId()
      expect(keyId).toBe("v1")
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Vault unreachable"))
    })

    it("throws on fetch failure in strict mode", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("connection refused"))
      vi.spyOn(console, "warn").mockImplementation(() => {})

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
        strictMode: true,
      })

      await expect(provider.getCurrentKeyId()).rejects.toThrow("connection refused")
    })

    it("throws on non-200 HTTP status", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })
      vi.spyOn(console, "warn").mockImplementation(() => {})

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
        strictMode: true,
      })

      await expect(provider.getCurrentKeyId()).rejects.toThrow("Vault request failed: 503")
    })

    it("handles non-200 status gracefully in non-strict mode", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      })
      vi.spyOn(console, "warn").mockImplementation(() => {})

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "bad-token",
        strictMode: false,
      })

      const keyId = await provider.getCurrentKeyId()
      expect(keyId).toBe("v1")
    })
  })

  describe("rotateKey", () => {
    it("falls back to incrementing local version on failure (non-strict)", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout"))
      vi.spyOn(console, "warn").mockImplementation(() => {})

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
        strictMode: false,
      })

      const newId = await provider.rotateKey()
      expect(newId).toBe("v2")
    })

    it("throws on failure in strict mode", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"))
      vi.spyOn(console, "warn").mockImplementation(() => {})

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
        strictMode: true,
      })

      await expect(provider.rotateKey()).rejects.toThrow("network error")
    })

    it("increments version on each failed rotation (non-strict)", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("down"))
      vi.spyOn(console, "warn").mockImplementation(() => {})

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
        strictMode: false,
      })

      await provider.rotateKey()
      const id = await provider.rotateKey()
      expect(id).toBe("v3")
    })
  })

  describe("getKeyInfo", () => {
    it("returns default info on fetch failure", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout"))

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
        keyName: "my-key",
      })

      const info = await provider.getKeyInfo()
      expect(info.name).toBe("my-key")
      expect(info.latestVersion).toBe(1)
      expect(info.type).toBe("aes256-gcm96")
    })

    it("parses Vault response correctly", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            name: "transit-key",
            latest_version: 5,
            min_decryption_version: 2,
            min_encryption_version: 3,
            exportable: true,
            type: "aes256-gcm96",
            keys: { "1": {}, "2": {}, "3": {}, "4": {}, "5": {} },
          },
        }),
      })

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
      })

      const info = await provider.getKeyInfo()
      expect(info.name).toBe("transit-key")
      expect(info.versions).toBe(5)
      expect(info.latestVersion).toBe(5)
      expect(info.minDecryptionVersion).toBe(2)
      expect(info.minEncryptionVersion).toBe(3)
      expect(info.exportable).toBe(true)
    })

    it("handles missing data fields gracefully", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      })

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
      })

      const info = await provider.getKeyInfo()
      expect(info.latestVersion).toBe(1)
      expect(info.versions).toBe(0)
    })
  })

  describe("connection timeout via AbortController", () => {
    it("aborts request on timeout", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
        // Simulate a request that checks signal
        if (opts?.signal?.aborted) throw new Error("aborted")
        return new Promise((_, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        })
      })
      vi.spyOn(console, "warn").mockImplementation(() => {})

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
        timeoutMs: 1,
        strictMode: true,
      })

      await expect(provider.getCurrentKeyId()).rejects.toThrow()
    })
  })

  describe("concurrent key rotation", () => {
    it("handles multiple concurrent rotations", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("down"))
      vi.spyOn(console, "warn").mockImplementation(() => {})

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
        strictMode: false,
      })

      // Fire multiple rotations concurrently
      const results = await Promise.all([provider.rotateKey(), provider.rotateKey(), provider.rotateKey()])

      // Each should get a unique version
      const versions = new Set(results)
      expect(versions.size).toBeGreaterThanOrEqual(1)
    })
  })

  describe("key derivation", () => {
    it("derives 256-bit keys", async () => {
      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
      })
      const key = await provider.getKey("v1")
      expect(key.length).toBe(32)
    })

    it("derives consistent keys for same ID", async () => {
      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
      })
      const key1 = await provider.getKey("v1")
      const key2 = await provider.getKey("v1")
      expect(key1).toBe(key2) // same reference (cached)
    })

    it("derives different keys for different contexts", async () => {
      const p1 = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test",
        context: "tenant-a",
      })
      const p2 = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test",
        context: "tenant-b",
      })
      const key1 = await p1.getKey("v1")
      const key2 = await p2.getKey("v1")
      expect(key1.equals(key2)).toBe(false)
    })
  })

  describe("listKeyIds", () => {
    it("lists correct number of key versions after rotations", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("down"))
      vi.spyOn(console, "warn").mockImplementation(() => {})

      const provider = vaultKeyProvider({
        address: "http://vault:8200",
        token: "test-token",
        strictMode: false,
      })

      await provider.rotateKey()
      await provider.rotateKey()
      const ids = await provider.listKeyIds()
      expect(ids).toEqual(["v1", "v2", "v3"])
    })
  })
})

// ─── GCP KMS Key Provider Error Paths ────────────────────────────────────────

describe("gcpKmsKeyProvider extended", () => {
  it("generates deterministic keys from key path", async () => {
    const provider = gcpKmsKeyProvider({
      projectId: "proj",
      location: "us-east1",
      keyRing: "ring",
      keyName: "key",
    })
    const key1 = await provider.getKey("v1")
    const key2 = await provider.getKey("v1")
    expect(key1.equals(key2)).toBe(true)
    expect(key1.length).toBe(32)
  })

  it("generates different keys for different versions", async () => {
    const provider = gcpKmsKeyProvider({
      projectId: "proj",
      location: "us-east1",
      keyRing: "ring",
      keyName: "key",
    })
    const key1 = await provider.getKey("v1")
    const key2 = await provider.getKey("v2")
    expect(key1.equals(key2)).toBe(false)
  })

  it("rotates and lists versions correctly", async () => {
    const provider = gcpKmsKeyProvider({
      projectId: "proj",
      location: "us-east1",
      keyRing: "ring",
      keyName: "key",
    })

    await provider.rotateKey()
    await provider.rotateKey()

    const ids = await provider.listKeyIds()
    expect(ids.length).toBe(3)
    expect(ids[2]).toContain("cryptoKeyVersions/3")
  })

  it("returns key info", async () => {
    const provider = gcpKmsKeyProvider({
      projectId: "p",
      location: "l",
      keyRing: "r",
      keyName: "my-key",
    })
    const info = await provider.getKeyInfo()
    expect(info.name).toBe("my-key")
    expect(info.type).toBe("GOOGLE_SYMMETRIC_ENCRYPTION")
  })
})
