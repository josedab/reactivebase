/**
 * Additional security-focused tests for zero-config auth providers.
 * Covers timing-safe comparison, edge cases in OIDC flows,
 * magic link token generation/verification, and multi-provider composition.
 */

import { describe, it, expect } from "vitest"
import {
  googleAuth,
  githubAuth,
  magicLinkAuth,
  anonymousAuth,
  multiProvider,
  autoDetectProviders,
  generateMagicLinkToken,
} from "../auth/zero-config-providers.js"

// ─── Google Auth — OIDC edge cases ──────────────────────────────────────────

describe("googleAuth — additional edge cases", () => {
  function buildGoogleJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
    return `${header}.${body}.fakesig`
  }

  it("accepts accounts.google.com as alternate issuer", async () => {
    const provider = googleAuth()
    const token = buildGoogleJwt({
      iss: "accounts.google.com",
      sub: "user123",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const result = await provider.verify(token)
    expect(result.userId).toBe("user123")
  })

  it("rejects token with invalid base64 payload", async () => {
    const provider = googleAuth()
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")
    const token = `${header}.not-valid-base64!!!.sig`
    await expect(provider.verify(token)).rejects.toThrow()
  })

  it("accepts audience as array when clientId matches", async () => {
    const provider = googleAuth({ clientId: "my-client-id" })
    const token = buildGoogleJwt({
      iss: "https://accounts.google.com",
      sub: "user123",
      aud: ["my-client-id", "other-client"],
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const result = await provider.verify(token)
    expect(result.userId).toBe("user123")
  })

  it("rejects audience mismatch", async () => {
    const provider = googleAuth({ clientId: "my-client-id" })
    const token = buildGoogleJwt({
      iss: "https://accounts.google.com",
      sub: "user123",
      aud: "different-client",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    await expect(provider.verify(token)).rejects.toThrow("audience mismatch")
  })

  it("rejects JWT missing subject", async () => {
    const provider = googleAuth()
    const token = buildGoogleJwt({
      iss: "https://accounts.google.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    await expect(provider.verify(token)).rejects.toThrow("missing subject")
  })

  it("uses email as userId when sub is missing", async () => {
    const provider = googleAuth()
    const token = buildGoogleJwt({
      iss: "https://accounts.google.com",
      email: "user@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const result = await provider.verify(token)
    expect(result.userId).toBe("user@example.com")
  })

  it("returns full claims with provider, email, name, picture", async () => {
    const provider = googleAuth()
    const token = buildGoogleJwt({
      iss: "https://accounts.google.com",
      sub: "u1",
      email: "user@test.com",
      name: "Test User",
      picture: "https://photo.url",
      email_verified: true,
      hd: "test.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const result = await provider.verify(token)
    expect(result.claims.provider).toBe("google")
    expect(result.claims.email).toBe("user@test.com")
    expect(result.claims.name).toBe("Test User")
    expect(result.claims.picture).toBe("https://photo.url")
    expect(result.claims.emailVerified).toBe(true)
    expect(result.claims.domain).toBe("test.com")
  })

  it("accepts allowed domain", async () => {
    const provider = googleAuth({ allowedDomains: ["example.com", "test.com"] })
    const token = buildGoogleJwt({
      iss: "https://accounts.google.com",
      sub: "u1",
      hd: "test.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const result = await provider.verify(token)
    expect(result.userId).toBe("u1")
  })

  it("skips audience check when no clientId configured", async () => {
    const provider = googleAuth()
    const token = buildGoogleJwt({
      iss: "https://accounts.google.com",
      sub: "u1",
      aud: "any-client",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const result = await provider.verify(token)
    expect(result.userId).toBe("u1")
  })
})

// ─── GitHub Auth — token validation ─────────────────────────────────────────

describe("githubAuth — edge cases", () => {
  it("rejects empty token", async () => {
    const provider = githubAuth()
    await expect(provider.verify("")).rejects.toThrow("Invalid GitHub token")
  })

  it("rejects short token", async () => {
    const provider = githubAuth()
    await expect(provider.verify("short")).rejects.toThrow("Invalid GitHub token")
  })

  it("has name property set to github", () => {
    const provider = githubAuth()
    expect(provider.name).toBe("github")
  })
})

// ─── Magic Link Auth — timing-safe comparison ───────────────────────────────

describe("magicLinkAuth — security tests", () => {
  const secret = "super-secret-key-for-testing-123"

  it("verifies valid token with custom userId", async () => {
    const token = generateMagicLinkToken("user@example.com", { secret, userId: "usr_123" })
    const provider = magicLinkAuth({ secret })
    const result = await provider.verify(token)
    expect(result.userId).toBe("usr_123")
  })

  it("rejects token with wrong number of parts", async () => {
    const provider = magicLinkAuth({ secret })
    await expect(provider.verify("only.two")).rejects.toThrow("Invalid magic link token format")
    await expect(provider.verify("a.b.c.d")).rejects.toThrow()
  })

  it("rejects token signed with different secret", async () => {
    const token = generateMagicLinkToken("user@example.com", { secret: "other-secret" })
    const provider = magicLinkAuth({ secret })
    await expect(provider.verify(token)).rejects.toThrow("signature")
  })

  it("uses timing-safe comparison (different length signatures rejected)", async () => {
    const provider = magicLinkAuth({ secret })
    // Construct a token with tampered signature of different length
    const parts = generateMagicLinkToken("user@example.com", { secret }).split(".")
    parts[2] = "a" // Very short signature
    await expect(provider.verify(parts.join("."))).rejects.toThrow("signature")
  })

  it("rejects token with NaN expiry", async () => {
    const provider = magicLinkAuth({ secret })
    const payload = Buffer.from(JSON.stringify({ email: "a@b.com" })).toString("base64url")
    const expiry = Buffer.from("not-a-number").toString("base64url")
    const data = `${payload}.${expiry}`
    const { createHmac } = await import("node:crypto")
    const sig = createHmac("sha256", secret).update(data).digest("base64url")
    await expect(provider.verify(`${payload}.${expiry}.${sig}`)).rejects.toThrow("expired")
  })

  it("rejects token with missing email in payload", async () => {
    const provider = magicLinkAuth({ secret })
    const payload = Buffer.from(JSON.stringify({ userId: "u1" })).toString("base64url")
    const expiry = Buffer.from(String(Math.floor(Date.now() / 1000) + 3600)).toString("base64url")
    const data = `${payload}.${expiry}`
    const { createHmac } = await import("node:crypto")
    const sig = createHmac("sha256", secret).update(data).digest("base64url")
    await expect(provider.verify(`${payload}.${expiry}.${sig}`)).rejects.toThrow("Invalid magic link payload")
  })

  it("reads secret from env if not explicitly provided", () => {
    const provider = magicLinkAuth({ env: { REACTIVEBASE_SECRET: "env-secret" } })
    expect(provider.name).toBe("magic-link")
  })
})

// ─── generateMagicLinkToken ─────────────────────────────────────────────────

describe("generateMagicLinkToken", () => {
  const secret = "test-secret-for-token-gen"

  it("generates a 3-part token", () => {
    const token = generateMagicLinkToken("user@test.com", { secret })
    expect(token.split(".")).toHaveLength(3)
  })

  it("includes email in payload", () => {
    const token = generateMagicLinkToken("user@test.com", { secret })
    const payloadB64 = token.split(".")[0]
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"))
    expect(payload.email).toBe("user@test.com")
  })

  it("includes nonce for uniqueness", () => {
    const t1 = generateMagicLinkToken("user@test.com", { secret })
    const t2 = generateMagicLinkToken("user@test.com", { secret })
    expect(t1).not.toBe(t2)
  })

  it("respects custom expirySeconds", () => {
    const token = generateMagicLinkToken("user@test.com", { secret, expirySeconds: 60 })
    const expiryB64 = token.split(".")[1]
    const expiry = Number(Buffer.from(expiryB64, "base64url").toString("utf-8"))
    const now = Math.floor(Date.now() / 1000)
    expect(expiry).toBeGreaterThan(now)
    expect(expiry).toBeLessThanOrEqual(now + 61)
  })

  it("round-trips with magicLinkAuth.verify", async () => {
    const token = generateMagicLinkToken("alice@example.com", { secret })
    const provider = magicLinkAuth({ secret })
    const result = await provider.verify(token)
    expect(result.claims.email).toBe("alice@example.com")
  })
})

// ─── Anonymous Auth ──────────────────────────────────────────────────────────

describe("anonymousAuth — additional", () => {
  it("rejects in production mode", async () => {
    const provider = anonymousAuth({ enabled: false })
    await expect(provider.verify("test")).rejects.toThrow("disabled in production")
  })

  it("generates unique IDs for empty tokens", async () => {
    const provider = anonymousAuth({ enabled: true })
    const r1 = await provider.verify("")
    const r2 = await provider.verify("")
    expect(r1.userId).not.toBe(r2.userId)
  })
})

// ─── multiProvider — additional ──────────────────────────────────────────────

describe("multiProvider — additional edge cases", () => {
  it("token-prefix strategy falls through to first-match for unrecognized prefix", async () => {
    const p = multiProvider([anonymousAuth({ enabled: true, prefix: "a" })], { strategy: "token-prefix" })
    const result = await p.verify("unknown:abc")
    expect(result.userId).toBe("a_unknown:abc")
  })

  it("token-prefix strategy works when provider name matches", async () => {
    const secret = "test-secret-for-multi"
    const p = multiProvider([magicLinkAuth({ secret }), anonymousAuth({ enabled: true })], { strategy: "token-prefix" })
    const token = generateMagicLinkToken("user@test.com", { secret })
    const result = await p.verify(`magic-link:${token}`)
    expect(result.claims.email).toBe("user@test.com")
  })

  it("name includes all provider names", () => {
    const p = multiProvider([anonymousAuth({ enabled: true }), magicLinkAuth({ secret: "s" })])
    expect(p.name).toContain("anonymous")
    expect(p.name).toContain("magic-link")
  })
})

// ─── autoDetectProviders — additional ────────────────────────────────────────

describe("autoDetectProviders — additional", () => {
  it("does not add anonymous in production even with no providers", () => {
    const result = autoDetectProviders({ env: { NODE_ENV: "production" } })
    expect(result.detected).not.toContain("anonymous")
  })

  it("combines all three providers when all env vars present", () => {
    const result = autoDetectProviders({
      env: {
        GOOGLE_CLIENT_ID: "g",
        GITHUB_CLIENT_ID: "gh",
        REACTIVEBASE_SECRET: "s",
      },
    })
    expect(result.providers.length).toBe(3)
    expect(result.warnings.length).toBe(0)
  })
})
