import { describe, it, expect } from "vitest"
import {
  googleAuth,
  magicLinkAuth,
  anonymousAuth,
  multiProvider,
  autoDetectProviders,
  zeroConfigAuth,
  generateMagicLinkToken,
} from "../auth/zero-config-providers.js"

describe("Zero-Config Auth Providers", () => {
  describe("googleAuth", () => {
    it("rejects non-JWT tokens", async () => {
      const provider = googleAuth()
      await expect(provider.verify("not-a-jwt")).rejects.toThrow("Invalid Google JWT format")
    })

    it("rejects expired Google JWTs", async () => {
      const provider = googleAuth()
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
      const payload = Buffer.from(
        JSON.stringify({
          iss: "https://accounts.google.com",
          sub: "user123",
          exp: Math.floor(Date.now() / 1000) - 3600,
        }),
      ).toString("base64url")
      const token = `${header}.${payload}.fakesig`
      await expect(provider.verify(token)).rejects.toThrow("expired")
    })

    it("rejects wrong issuer", async () => {
      const provider = googleAuth()
      const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")
      const payload = Buffer.from(
        JSON.stringify({ iss: "https://evil.com", sub: "user123", exp: Math.floor(Date.now() / 1000) + 3600 }),
      ).toString("base64url")
      const token = `${header}.${payload}.fakesig`
      await expect(provider.verify(token)).rejects.toThrow("issuer")
    })

    it("rejects disallowed domains", async () => {
      const provider = googleAuth({ allowedDomains: ["example.com"] })
      const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")
      const payload = Buffer.from(
        JSON.stringify({
          iss: "https://accounts.google.com",
          sub: "user123",
          exp: Math.floor(Date.now() / 1000) + 3600,
          hd: "other.com",
        }),
      ).toString("base64url")
      const token = `${header}.${payload}.fakesig`
      await expect(provider.verify(token)).rejects.toThrow("not in allowed list")
    })
  })

  describe("magicLinkAuth", () => {
    const secret = "test-secret-key-for-magic-links"

    it("verifies a valid magic link token", async () => {
      const token = generateMagicLinkToken("user@example.com", { secret })
      const provider = magicLinkAuth({ secret })
      const result = await provider.verify(token)
      expect(result.userId).toBe("user@example.com")
      expect(result.claims.provider).toBe("magic-link")
      expect(result.claims.email).toBe("user@example.com")
    })

    it("generates token with custom userId", () => {
      const token = generateMagicLinkToken("user@example.com", { secret, userId: "usr_123" })
      expect(token.split(".")).toHaveLength(3)
    })

    it("rejects tampered tokens", async () => {
      const token = generateMagicLinkToken("user@example.com", { secret })
      const tampered = token.slice(0, -5) + "xxxxx"
      const provider = magicLinkAuth({ secret })
      await expect(provider.verify(tampered)).rejects.toThrow("signature")
    })

    it("rejects expired tokens", async () => {
      const token = generateMagicLinkToken("user@example.com", { secret, expirySeconds: -1 })
      const provider = magicLinkAuth({ secret })
      await expect(provider.verify(token)).rejects.toThrow("expired")
    })

    it("requires secret", async () => {
      const provider = magicLinkAuth({ env: {} })
      await expect(provider.verify("any")).rejects.toThrow("REACTIVEBASE_SECRET")
    })
  })

  describe("anonymousAuth", () => {
    it("generates anonymous user ID", async () => {
      const provider = anonymousAuth({ enabled: true })
      const result = await provider.verify("session-123")
      expect(result.userId).toBe("anon_session-123")
      expect(result.claims.anonymous).toBe(true)
    })

    it("uses custom prefix", async () => {
      const provider = anonymousAuth({ prefix: "guest", enabled: true })
      const result = await provider.verify("abc")
      expect(result.userId).toBe("guest_abc")
    })

    it("generates random ID for empty token", async () => {
      const provider = anonymousAuth({ enabled: true })
      const result = await provider.verify("")
      expect(result.userId).toMatch(/^anon_/)
    })
  })

  describe("multiProvider", () => {
    it("tries providers in order (first-match)", async () => {
      const provider = multiProvider([
        anonymousAuth({ enabled: true, prefix: "a" }),
        anonymousAuth({ enabled: true, prefix: "b" }),
      ])
      const result = await provider.verify("test")
      expect(result.userId).toBe("a_test")
    })

    it("supports token-prefix strategy", async () => {
      const p = multiProvider(
        [
          anonymousAuth({ enabled: true, prefix: "first" }),
          anonymousAuth({ enabled: true, prefix: "second" }),
        ],
        { strategy: "token-prefix" },
      )
      // "anonymous:xyz" should select the anonymous provider by name
      const result = await p.verify("anonymous:xyz")
      expect(result.userId).toBe("first_xyz") // falls through since name match finds "anonymous"
    })

    it("requires at least one provider", () => {
      expect(() => multiProvider([])).toThrow("at least one provider")
    })

    it("reports all errors when no provider matches", async () => {
      const p = multiProvider([magicLinkAuth({ secret: "s1" })])
      await expect(p.verify("bad")).rejects.toThrow("No auth provider could verify")
    })
  })

  describe("autoDetectProviders", () => {
    it("detects Google from env", () => {
      const result = autoDetectProviders({ env: { GOOGLE_CLIENT_ID: "test-id" } })
      expect(result.detected).toContain("google")
      expect(result.providers).toHaveLength(1)
    })

    it("detects GitHub from env", () => {
      const result = autoDetectProviders({ env: { GITHUB_CLIENT_ID: "test-id" } })
      expect(result.detected).toContain("github")
    })

    it("detects magic link from env", () => {
      const result = autoDetectProviders({ env: { REACTIVEBASE_SECRET: "secret" } })
      expect(result.detected).toContain("magic-link")
    })

    it("falls back to anonymous in dev", () => {
      const result = autoDetectProviders({ env: { NODE_ENV: "development" } })
      expect(result.detected).toContain("anonymous")
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it("warns when no providers in production", () => {
      const result = autoDetectProviders({ env: { NODE_ENV: "production" } })
      expect(result.providers).toHaveLength(0)
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it("detects multiple providers", () => {
      const result = autoDetectProviders({
        env: { GOOGLE_CLIENT_ID: "g", GITHUB_CLIENT_ID: "gh", REACTIVEBASE_SECRET: "s" },
      })
      expect(result.detected).toEqual(["google", "github", "magic-link"])
      expect(result.providers).toHaveLength(3)
    })
  })

  describe("zeroConfigAuth", () => {
    it("returns single provider when only one detected", () => {
      const provider = zeroConfigAuth({ env: { GOOGLE_CLIENT_ID: "test" } })
      expect(provider.name).toBe("google")
    })

    it("returns multi-provider when multiple detected", () => {
      const provider = zeroConfigAuth({
        env: { GOOGLE_CLIENT_ID: "g", GITHUB_CLIENT_ID: "gh" },
      })
      expect(provider.name).toContain("multi")
    })

    it("returns anonymous when nothing detected", () => {
      const provider = zeroConfigAuth({ env: {} })
      expect(provider.name).toBe("anonymous")
    })
  })
})
