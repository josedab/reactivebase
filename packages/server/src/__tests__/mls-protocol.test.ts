/**
 * Tests for MLS-inspired E2E encryption: key management, group lifecycle,
 * encrypted CRDT bridge, key escrow, and audit logging.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { randomBytes, createHmac, createHash } from "node:crypto"
import {
  MlsKeyManager,
  EncryptedCrdtBridge,
  KeyEscrow,
  MlsError,
  generateMlsGroupTableSQL,
  generateMlsKeyHistoryTableSQL,
  generateMlsAuditTableSQL,
  buildInsertMlsAuditSQL,
} from "../encryption/mls-protocol.js"

// ─── MlsKeyManager ──────────────────────────────────────────────────────────

describe("MlsKeyManager", () => {
  let manager: MlsKeyManager

  beforeEach(() => {
    manager = new MlsKeyManager()
  })

  describe("group lifecycle", () => {
    it("creates a group with creator as first member", () => {
      const group = manager.createGroup("doc-1", "device-alice")
      expect(group.groupId).toBe("doc-1")
      expect(group.epoch).toBe(0)
      expect(group.members.size).toBe(1)
      expect(group.members.get("device-alice")).toBeDefined()
      expect(group.members.get("device-alice")!.verified).toBe(true)
      expect(group.groupSecret).toBeInstanceOf(Buffer)
      expect(group.groupSecret.length).toBe(32)
    })

    it("throws when creating a duplicate group", () => {
      manager.createGroup("doc-1", "device-alice")
      expect(() => manager.createGroup("doc-1", "device-bob")).toThrow(MlsError)
      expect(() => manager.createGroup("doc-1", "device-bob")).toThrow("already exists")
    })

    it("creates groups with custom key schedule", () => {
      const group = manager.createGroup("doc-1", "device-alice", {
        rotateOnAdd: true,
        maxEpoch: 500,
      })
      expect(group.keySchedule.rotateOnAdd).toBe(true)
      expect(group.keySchedule.maxEpoch).toBe(500)
      expect(group.keySchedule.rotateOnRemove).toBe(true) // default
    })
  })

  describe("member management", () => {
    it("adds a member to the group", () => {
      manager.createGroup("doc-1", "device-alice")
      const publicKey = randomBytes(32)
      const member = manager.addMember("doc-1", "device-bob", publicKey)

      expect(member.deviceId).toBe("device-bob")
      expect(member.verified).toBe(false)
      expect(member.publicKey).toBe(publicKey)

      const group = manager.getGroup("doc-1")!
      expect(group.members.size).toBe(2)
    })

    it("throws when adding duplicate member", () => {
      manager.createGroup("doc-1", "device-alice")
      manager.addMember("doc-1", "device-bob", randomBytes(32))
      expect(() => manager.addMember("doc-1", "device-bob", randomBytes(32))).toThrow("already a member")
    })

    it("throws when adding to nonexistent group", () => {
      expect(() => manager.addMember("nonexistent", "d1", randomBytes(32))).toThrow("not found")
    })

    it("changes group secret when member is added", () => {
      const group = manager.createGroup("doc-1", "device-alice")
      const secretBefore = Buffer.from(group.groupSecret)
      manager.addMember("doc-1", "device-bob", randomBytes(32))
      expect(group.groupSecret.equals(secretBefore)).toBe(false)
    })

    it("removes a member from the group", () => {
      manager.createGroup("doc-1", "device-alice")
      manager.addMember("doc-1", "device-bob", randomBytes(32))
      manager.removeMember("doc-1", "device-bob")

      const group = manager.getGroup("doc-1")!
      expect(group.members.size).toBe(1)
      expect(group.members.has("device-bob")).toBe(false)
    })

    it("rotates keys on member removal (forward secrecy)", () => {
      manager.createGroup("doc-1", "device-alice")
      manager.addMember("doc-1", "device-bob", randomBytes(32))
      const group = manager.getGroup("doc-1")!
      const epochBefore = group.epoch

      manager.removeMember("doc-1", "device-bob")
      expect(group.epoch).toBeGreaterThan(epochBefore)
    })

    it("throws when removing nonexistent member", () => {
      manager.createGroup("doc-1", "device-alice")
      expect(() => manager.removeMember("doc-1", "device-bob")).toThrow("not a member")
    })

    it("optionally rotates keys on member addition", () => {
      manager.createGroup("doc-1", "device-alice", { rotateOnAdd: true })
      const group = manager.getGroup("doc-1")!
      const epochBefore = group.epoch

      manager.addMember("doc-1", "device-bob", randomBytes(32))
      expect(group.epoch).toBeGreaterThan(epochBefore)
    })
  })

  describe("key rotation", () => {
    it("manually rotates keys", () => {
      manager.createGroup("doc-1", "device-alice")
      const group = manager.getGroup("doc-1")!
      const secretBefore = Buffer.from(group.groupSecret)

      manager.rotateKeys("doc-1")
      expect(group.epoch).toBe(1)
      expect(group.groupSecret.equals(secretBefore)).toBe(false)
    })

    it("throws when rotating keys for nonexistent group", () => {
      expect(() => manager.rotateKeys("nonexistent")).toThrow("not found")
    })

    it("successive rotations produce different secrets", () => {
      manager.createGroup("doc-1", "device-alice")
      manager.rotateKeys("doc-1")
      const s1 = Buffer.from(manager.getGroupKey("doc-1"))
      manager.rotateKeys("doc-1")
      const s2 = Buffer.from(manager.getGroupKey("doc-1"))
      expect(s1.equals(s2)).toBe(false)
    })
  })

  describe("getGroupKey / getKeySchedule", () => {
    it("returns the group key", () => {
      manager.createGroup("doc-1", "device-alice")
      const key = manager.getGroupKey("doc-1")
      expect(key).toBeInstanceOf(Buffer)
      expect(key.length).toBe(32)
    })

    it("throws for nonexistent group", () => {
      expect(() => manager.getGroupKey("nonexistent")).toThrow("not found")
    })

    it("returns a copy of the key schedule", () => {
      manager.createGroup("doc-1", "device-alice", { maxEpoch: 500 })
      const schedule = manager.getKeySchedule("doc-1")
      expect(schedule.maxEpoch).toBe(500)
    })
  })

  describe("device verification", () => {
    it("verifies a device with valid challenge", () => {
      manager.createGroup("doc-1", "device-alice")
      manager.addMember("doc-1", "device-bob", randomBytes(32))
      const challenge = randomBytes(32)
      const result = manager.verifyDevice("doc-1", "device-bob", challenge)
      expect(result).toBe(true)

      const member = manager.getGroup("doc-1")!.members.get("device-bob")!
      expect(member.verified).toBe(true)
    })

    it("throws for nonexistent device", () => {
      manager.createGroup("doc-1", "device-alice")
      expect(() => manager.verifyDevice("doc-1", "unknown", randomBytes(32))).toThrow("not a member")
    })
  })

  describe("queries", () => {
    it("getGroup returns undefined for nonexistent group", () => {
      expect(manager.getGroup("nonexistent")).toBeUndefined()
    })

    it("getGroupIds returns all group IDs", () => {
      manager.createGroup("doc-1", "d1")
      manager.createGroup("doc-2", "d2")
      expect(manager.getGroupIds()).toEqual(["doc-1", "doc-2"])
    })
  })

  describe("audit log", () => {
    it("records group creation", () => {
      manager.createGroup("doc-1", "device-alice")
      const log = manager.getAuditLog("doc-1")
      expect(log.length).toBeGreaterThanOrEqual(1)
      expect(log[0].action).toBe("group_created")
    })

    it("records member add/remove", () => {
      manager.createGroup("doc-1", "device-alice")
      manager.addMember("doc-1", "device-bob", randomBytes(32))
      manager.removeMember("doc-1", "device-bob")

      const log = manager.getAuditLog("doc-1")
      const actions = log.map((e) => e.action)
      expect(actions).toContain("member_added")
      expect(actions).toContain("member_removed")
    })

    it("records key rotation", () => {
      manager.createGroup("doc-1", "device-alice")
      manager.rotateKeys("doc-1")

      const log = manager.getAuditLog("doc-1")
      expect(log.some((e) => e.action === "keys_rotated")).toBe(true)
    })

    it("getAuditLog without groupId returns all entries", () => {
      manager.createGroup("doc-1", "d1")
      manager.createGroup("doc-2", "d2")
      const allLog = manager.getAuditLog()
      expect(allLog.length).toBeGreaterThanOrEqual(2)
    })
  })
})

// ─── EncryptedCrdtBridge ─────────────────────────────────────────────────────

describe("EncryptedCrdtBridge", () => {
  let manager: MlsKeyManager
  let bridge: EncryptedCrdtBridge

  beforeEach(() => {
    manager = new MlsKeyManager()
    manager.createGroup("doc-1", "device-alice")
    bridge = new EncryptedCrdtBridge(manager)
  })

  describe("encrypt/decrypt round-trip", () => {
    it("encrypts and decrypts an operation", () => {
      const plaintext = new TextEncoder().encode("Hello CRDT")
      const encrypted = bridge.encryptOperation("doc-1", plaintext, "device-alice")

      expect(encrypted.groupId).toBe("doc-1")
      expect(encrypted.epoch).toBe(0)
      expect(encrypted.ciphertext).toBeTruthy()
      expect(encrypted.iv).toBeTruthy()
      expect(encrypted.authTag).toBeTruthy()
      expect(encrypted.senderDeviceId).toBe("device-alice")
      expect(encrypted.sequenceNumber).toBe(1)

      const decrypted = bridge.decryptOperation("doc-1", encrypted)
      expect(new TextDecoder().decode(decrypted)).toBe("Hello CRDT")
    })

    it("encrypts binary data correctly", () => {
      const data = new Uint8Array([0, 1, 2, 255, 128, 64])
      const encrypted = bridge.encryptOperation("doc-1", data, "device-alice")
      const decrypted = bridge.decryptOperation("doc-1", encrypted)
      expect(decrypted).toEqual(data)
    })

    it("increments sequence numbers", () => {
      const data = new Uint8Array([1])
      const e1 = bridge.encryptOperation("doc-1", data, "device-alice")
      const e2 = bridge.encryptOperation("doc-1", data, "device-alice")
      expect(e1.sequenceNumber).toBe(1)
      expect(e2.sequenceNumber).toBe(2)
    })

    it("produces different ciphertexts for same plaintext", () => {
      const data = new Uint8Array([1, 2, 3])
      const e1 = bridge.encryptOperation("doc-1", data, "device-alice")
      const e2 = bridge.encryptOperation("doc-1", data, "device-alice")
      expect(e1.ciphertext).not.toBe(e2.ciphertext)
    })
  })

  describe("error cases", () => {
    it("throws for nonexistent group on encrypt", () => {
      expect(() => bridge.encryptOperation("nonexistent", new Uint8Array([1]), "d1")).toThrow("not found")
    })

    it("fails to decrypt with wrong key (after rotation)", () => {
      const data = new Uint8Array([1, 2, 3])
      const encrypted = bridge.encryptOperation("doc-1", data, "device-alice")

      manager.rotateKeys("doc-1")
      // Key changed; decryption should fail
      expect(() => bridge.decryptOperation("doc-1", encrypted)).toThrow()
    })
  })

  describe("mergeEncrypted", () => {
    it("sorts operations by groupId, epoch, sequence", () => {
      const ops = [
        {
          groupId: "b",
          epoch: 1,
          sequenceNumber: 2,
          ciphertext: "",
          iv: "",
          authTag: "",
          senderDeviceId: "d1",
          timestamp: 0,
        },
        {
          groupId: "a",
          epoch: 0,
          sequenceNumber: 1,
          ciphertext: "",
          iv: "",
          authTag: "",
          senderDeviceId: "d1",
          timestamp: 0,
        },
        {
          groupId: "a",
          epoch: 0,
          sequenceNumber: 2,
          ciphertext: "",
          iv: "",
          authTag: "",
          senderDeviceId: "d2",
          timestamp: 0,
        },
      ]
      const merged = bridge.mergeEncrypted(ops)
      expect(merged[0].groupId).toBe("a")
      expect(merged[1].groupId).toBe("a")
      expect(merged[2].groupId).toBe("b")
    })

    it("deduplicates by sender+sequence+epoch", () => {
      const op = {
        groupId: "a",
        epoch: 0,
        sequenceNumber: 1,
        ciphertext: "c1",
        iv: "",
        authTag: "",
        senderDeviceId: "d1",
        timestamp: 0,
      }
      const merged = bridge.mergeEncrypted([op, { ...op, ciphertext: "c2" }])
      expect(merged.length).toBe(1)
    })
  })
})

// ─── KeyEscrow ───────────────────────────────────────────────────────────────

describe("KeyEscrow", () => {
  let manager: MlsKeyManager
  let escrow: KeyEscrow

  beforeEach(() => {
    manager = new MlsKeyManager()
    manager.createGroup("doc-1", "device-alice")
    escrow = new KeyEscrow(manager)
  })

  describe("escrow lifecycle", () => {
    it("enables escrow for a group", () => {
      const config = escrow.enableEscrow("doc-1", "escrow-key-1")
      expect(config.enabled).toBe(true)
      expect(config.escrowKeyId).toBe("escrow-key-1")
      expect(config.wrappedGroupSecret).toBeTruthy()
    })

    it("disables escrow", () => {
      escrow.enableEscrow("doc-1", "escrow-key-1")
      escrow.disableEscrow("doc-1")
      // Should throw since escrow is disabled
      expect(() => escrow.disableEscrow("doc-1")).toThrow("not enabled")
    })

    it("throws when disabling escrow that was never enabled", () => {
      expect(() => escrow.disableEscrow("doc-1")).toThrow("not enabled")
    })
  })

  describe("key recovery", () => {
    it("recovers the group key with valid authorization", () => {
      escrow.enableEscrow("doc-1", "escrow-key-1")

      // The escrow key is derived from the escrow key ID
      const escrowKey = createHash("sha256").update("escrow-key-1").digest()
      const authToken = createHmac("sha256", escrowKey).update("recover:doc-1").digest("hex")

      const recovered = escrow.recoverKey("doc-1", escrowKey, authToken)
      expect(recovered).toBeInstanceOf(Buffer)

      // Recovered key should match the original group key
      const originalKey = manager.getGroupKey("doc-1")
      expect(recovered.equals(originalKey)).toBe(true)
    })

    it("rejects invalid authorization token", () => {
      escrow.enableEscrow("doc-1", "escrow-key-1")
      const escrowKey = createHash("sha256").update("escrow-key-1").digest()
      expect(() => escrow.recoverKey("doc-1", escrowKey, "bad-token")).toThrow("Invalid authorization token")
    })

    it("throws when escrow is not enabled", () => {
      const escrowKey = randomBytes(32)
      expect(() => escrow.recoverKey("doc-1", escrowKey, "token")).toThrow("not enabled")
    })
  })

  describe("access control", () => {
    it("grants and retrieves access", () => {
      const grant = escrow.grantAccess("doc-1", "user-1", "read", "admin")
      expect(grant.userId).toBe("user-1")
      expect(grant.permissions).toBe("read")
      expect(grant.grantedBy).toBe("admin")

      const grants = escrow.getAccessGrants("doc-1")
      expect(grants.length).toBe(1)
    })

    it("replaces existing grant for same user", () => {
      escrow.grantAccess("doc-1", "user-1", "read")
      escrow.grantAccess("doc-1", "user-1", "admin")

      const grants = escrow.getAccessGrants("doc-1")
      expect(grants.length).toBe(1)
      expect(grants[0].permissions).toBe("admin")
    })

    it("revokes access", () => {
      escrow.grantAccess("doc-1", "user-1", "read")
      escrow.revokeAccess("doc-1", "user-1")

      const grants = escrow.getAccessGrants("doc-1")
      expect(grants.length).toBe(0)
    })
  })

  describe("audit trail", () => {
    it("records escrow enable/disable events", () => {
      escrow.enableEscrow("doc-1", "ek-1")
      escrow.disableEscrow("doc-1")

      const trail = escrow.getAuditTrail("doc-1")
      const actions = trail.map((e) => e.action)
      expect(actions).toContain("escrow_enabled")
      expect(actions).toContain("escrow_disabled")
    })

    it("records access grant/revoke events", () => {
      escrow.grantAccess("doc-1", "user-1", "read")
      escrow.revokeAccess("doc-1", "user-1")

      const trail = escrow.getAuditTrail("doc-1")
      const actions = trail.map((e) => e.action)
      expect(actions).toContain("access_granted")
      expect(actions).toContain("access_revoked")
    })
  })
})

// ─── SQL Generators ──────────────────────────────────────────────────────────

describe("SQL generators", () => {
  it("generateMlsGroupTableSQL creates group and member tables", () => {
    const sql = generateMlsGroupTableSQL()
    expect(sql).toContain("_reactivebase_mls_groups")
    expect(sql).toContain("_reactivebase_mls_members")
    expect(sql).toContain("PRIMARY KEY")
  })

  it("generateMlsKeyHistoryTableSQL creates key history table", () => {
    const sql = generateMlsKeyHistoryTableSQL()
    expect(sql).toContain("_reactivebase_mls_key_history")
    expect(sql).toContain("epoch")
  })

  it("generateMlsAuditTableSQL creates audit table with indices", () => {
    const sql = generateMlsAuditTableSQL()
    expect(sql).toContain("_reactivebase_mls_audit")
    expect(sql).toContain("CREATE INDEX")
  })

  it("buildInsertMlsAuditSQL generates correct SQL", () => {
    const entry = {
      id: "audit_1",
      groupId: "doc-1",
      action: "group_created" as const,
      actorDeviceId: "device-alice",
      targetDeviceId: undefined,
      details: { epoch: 0 },
      timestamp: Date.now(),
    }
    const { sql, params } = buildInsertMlsAuditSQL(entry)
    expect(sql).toContain("INSERT INTO _reactivebase_mls_audit")
    expect(params).toHaveLength(6)
    expect(params[0]).toBe("audit_1")
  })
})
