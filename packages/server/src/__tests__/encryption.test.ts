import { describe, it, expect, beforeEach } from "vitest"
import {
  EncryptionEngine,
  _EncryptionError,
  localKeyProvider,
  rotatingKeyProvider,
  generateEncryptionTableSQL,
  buildInsertAuditSQL,
} from "../encryption/encryption.js"

describe("EncryptionEngine", () => {
  let engine: EncryptionEngine

  beforeEach(() => {
    engine = new EncryptionEngine({
      provider: localKeyProvider("test-master-key-32-chars-long!!!"),
    })
  })

  describe("field encryption", () => {
    it("encrypts and decrypts a string", async () => {
      const encrypted = await engine.encryptField("ssn", "123-45-6789")
      expect(encrypted.ciphertext).toBeTruthy()
      expect(encrypted.iv).toBeTruthy()
      expect(encrypted.authTag).toBeTruthy()
      expect(encrypted.keyId).toBeTruthy()

      const decrypted = await engine.decryptField("ssn", encrypted)
      expect(decrypted).toBe("123-45-6789")
    })

    it("encrypts and decrypts an object", async () => {
      const data = { name: "John", age: 30 }
      const encrypted = await engine.encryptField("profile", data)
      const decrypted = await engine.decryptField("profile", encrypted)
      expect(decrypted).toEqual(data)
    })

    it("produces different ciphertexts in random mode", async () => {
      const enc1 = await engine.encryptField("f", "same-value", "random")
      const enc2 = await engine.encryptField("f", "same-value", "random")
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext)
    })

    it("produces same ciphertext in deterministic mode", async () => {
      const enc1 = await engine.encryptField("f", "same-value", "deterministic")
      const enc2 = await engine.encryptField("f", "same-value", "deterministic")
      expect(enc1.ciphertext).toBe(enc2.ciphertext)
    })

    it("fails to decrypt with wrong key", async () => {
      const encrypted = await engine.encryptField("f", "secret")

      const otherEngine = new EncryptionEngine({
        provider: localKeyProvider("different-master-key-32-chars!!"),
      })

      await expect(
        otherEngine.decryptField("f", {
          ...encrypted,
          keyId: "local-key-1",
        }),
      ).rejects.toThrow()
    })
  })

  describe("field configuration", () => {
    it("configures encrypted fields", () => {
      engine.configureField({ table: "users", field: "ssn", mode: "deterministic", searchable: true })
      expect(engine.isFieldEncrypted("users", "ssn")).toBe(true)
      expect(engine.isFieldEncrypted("users", "name")).toBe(false)
    })

    it("returns field config", () => {
      engine.configureField({ table: "users", field: "ssn" })
      const config = engine.getFieldConfig("users", "ssn")
      expect(config?.field).toBe("ssn")
    })
  })

  describe("row encryption", () => {
    it("encrypts configured fields in a row", async () => {
      engine.configureField({ table: "users", field: "ssn" })

      const row = { name: "John", ssn: "123-45-6789", email: "john@test.com" }
      const encrypted = await engine.encryptRow("users", row)

      expect(encrypted.name).toBe("John") // Not encrypted
      expect(encrypted.email).toBe("john@test.com") // Not encrypted
      expect(typeof encrypted.ssn).toBe("object") // Encrypted
    })

    it("decrypts configured fields in a row", async () => {
      engine.configureField({ table: "users", field: "ssn" })

      const row = { name: "John", ssn: "123-45-6789" }
      const encrypted = await engine.encryptRow("users", row)
      const decrypted = await engine.decryptRow("users", encrypted)

      expect(decrypted.name).toBe("John")
      expect(decrypted.ssn).toBe("123-45-6789")
    })
  })

  describe("key rotation", () => {
    it("re-encrypts with current key", async () => {
      const encrypted = await engine.encryptField("f", "secret")
      const reEncrypted = await engine.reEncryptValue("f", encrypted)
      expect(reEncrypted.ciphertext).toBeTruthy()

      const decrypted = await engine.decryptField("f", reEncrypted)
      expect(decrypted).toBe("secret")
    })
  })

  describe("stats", () => {
    it("tracks encryption stats", async () => {
      await engine.encryptField("f", "a")
      await engine.encryptField("f", "b")
      const encrypted = await engine.encryptField("f", "c")
      await engine.decryptField("f", encrypted)

      const stats = await engine.getStats()
      expect(stats.totalEncryptions).toBe(3)
      expect(stats.totalDecryptions).toBe(1)
      expect(stats.activeKeyId).toBeTruthy()
    })
  })

  describe("provider name", () => {
    it("returns the provider name", () => {
      expect(engine.providerName).toBe("local")
    })
  })
})

describe("rotatingKeyProvider", () => {
  it("supports multiple keys", async () => {
    const provider = rotatingKeyProvider({ "key-1": "secret-1", "key-2": "secret-2" }, "key-2")
    expect(await provider.getCurrentKeyId()).toBe("key-2")
    expect((await provider.listKeyIds()).length).toBe(2)
  })

  it("throws on missing current key", () => {
    expect(() => rotatingKeyProvider({ "key-1": "s" }, "key-missing")).toThrow()
  })
})

describe("SQL builders", () => {
  it("generateEncryptionTableSQL creates tables", () => {
    const sql = generateEncryptionTableSQL()
    expect(sql).toContain("_reactivebase_encryption_keys")
    expect(sql).toContain("_reactivebase_encryption_audit")
  })

  it("buildInsertAuditSQL generates insert", () => {
    const { sql, params } = buildInsertAuditSQL("encrypt", "ssn", "users", "key-1", "user-1")
    expect(sql).toContain("INSERT INTO")
    expect(params).toHaveLength(5)
  })
})
