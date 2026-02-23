import { describe, it, expect } from "vitest"
import { vaultKeyProvider, gcpKmsKeyProvider, VaultError } from "../encryption/vault-provider.js"
import { v } from "../schema/validators.js"

describe("vaultKeyProvider", () => {
  it("derives keys from key name", async () => {
    const provider = vaultKeyProvider({
      address: "http://vault:8200",
      token: "test-token",
      keyName: "my-key",
    })
    expect(provider.name).toBe("vault")

    const key = await provider.getKey("v1")
    expect(key).toBeInstanceOf(Buffer)
    expect(key.length).toBe(32) // 256-bit
  })

  it("derives different keys for different IDs", async () => {
    const provider = vaultKeyProvider({
      address: "http://vault:8200",
      token: "test-token",
    })
    const key1 = await provider.getKey("v1")
    const key2 = await provider.getKey("v2")
    expect(key1.equals(key2)).toBe(false)
  })

  it("caches derived keys", async () => {
    const provider = vaultKeyProvider({
      address: "http://vault:8200",
      token: "test-token",
    })
    const key1 = await provider.getKey("v1")
    const key2 = await provider.getKey("v1")
    expect(key1).toBe(key2) // same object reference
  })

  it("returns current key ID", async () => {
    const provider = vaultKeyProvider({
      address: "http://vault:8200",
      token: "test-token",
    })
    const keyId = await provider.getCurrentKeyId()
    expect(keyId).toBe("v1")
  })

  it("lists key IDs", async () => {
    const provider = vaultKeyProvider({
      address: "http://vault:8200",
      token: "test-token",
    })
    const ids = await provider.listKeyIds()
    expect(ids).toContain("v1")
  })

  it("rotates key and increments version", async () => {
    const provider = vaultKeyProvider({
      address: "http://vault:8200",
      token: "test-token",
    })
    const newKeyId = await provider.rotateKey()
    expect(newKeyId).toBe("v2")
    const currentId = await provider.getCurrentKeyId()
    expect(currentId).toBe("v2")
  })

  it("gets key info", async () => {
    const provider = vaultKeyProvider({
      address: "http://vault:8200",
      token: "test-token",
    })
    const info = await provider.getKeyInfo()
    expect(info.name).toBe("reactivebase-key")
    expect(info.latestVersion).toBe(1)
  })

  it("supports context for per-tenant isolation", async () => {
    const provider1 = vaultKeyProvider({
      address: "http://vault:8200",
      token: "test",
      context: "tenant-a",
    })
    const provider2 = vaultKeyProvider({
      address: "http://vault:8200",
      token: "test",
      context: "tenant-b",
    })
    const key1 = await provider1.getKey("v1")
    const key2 = await provider2.getKey("v1")
    expect(key1.equals(key2)).toBe(false)
  })
})

describe("gcpKmsKeyProvider", () => {
  it("creates provider with correct name", () => {
    const provider = gcpKmsKeyProvider({
      projectId: "my-project",
      location: "us-east1",
      keyRing: "my-ring",
      keyName: "my-key",
    })
    expect(provider.name).toBe("gcp-kms")
  })

  it("derives keys from key path", async () => {
    const provider = gcpKmsKeyProvider({
      projectId: "p",
      location: "l",
      keyRing: "r",
      keyName: "k",
    })
    const key = await provider.getKey("v1")
    expect(key).toBeInstanceOf(Buffer)
    expect(key.length).toBe(32)
  })

  it("generates key path as current key ID", async () => {
    const provider = gcpKmsKeyProvider({
      projectId: "my-project",
      location: "us-east1",
      keyRing: "my-ring",
      keyName: "my-key",
    })
    const id = await provider.getCurrentKeyId()
    expect(id).toContain("my-project")
    expect(id).toContain("cryptoKeyVersions/1")
  })

  it("rotates key", async () => {
    const provider = gcpKmsKeyProvider({
      projectId: "p",
      location: "l",
      keyRing: "r",
      keyName: "k",
    })
    const id = await provider.rotateKey()
    expect(id).toContain("cryptoKeyVersions/2")
  })
})

describe("v.encrypted()", () => {
  it("creates an encrypted validator wrapping inner type", () => {
    const validator = v.encrypted(v.string())
    expect(validator.pgType).toBe("jsonb")
    expect(validator.options.__encrypted).toBe(true)
    expect(validator.innerValidator).toBeDefined()
    expect(validator.innerValidator?.type).toBe("string")
  })

  it("wraps different inner types", () => {
    const intVal = v.encrypted(v.integer())
    expect(intVal.innerValidator?.type).toBe("integer")

    const boolVal = v.encrypted(v.boolean())
    expect(boolVal.innerValidator?.type).toBe("boolean")
  })
})
