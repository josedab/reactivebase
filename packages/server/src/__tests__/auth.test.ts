import { describe, it, expect } from "vitest"
import {
  createAuthContext,
  jwtProvider,
  tokenProvider,
  defineRlsPolicy,
  AuthenticationError,
  AuthorizationError,
} from "../auth/auth.js"
import { createHmac, generateKeyPairSync, createSign } from "node:crypto"

function createTestJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  return `${header}.${body}.${signature}`
}

describe("auth context", () => {
  it("creates authenticated context", () => {
    const ctx = createAuthContext("user1", { role: "admin" })

    expect(ctx.userId).toBe("user1")
    expect(ctx.claims.role).toBe("admin")
  })

  it("creates unauthenticated context", () => {
    const ctx = createAuthContext(null)

    expect(ctx.userId).toBeNull()
  })

  it("requireUser throws for unauthenticated", () => {
    const ctx = createAuthContext(null)

    expect(() => ctx.requireUser()).toThrow(AuthenticationError)
  })

  it("requireUser returns userId for authenticated", () => {
    const ctx = createAuthContext("user1")

    expect(ctx.requireUser()).toBe("user1")
  })

  it("requireRole throws for wrong role", () => {
    const ctx = createAuthContext("user1", { role: "member" })

    expect(() => ctx.requireRole("admin")).toThrow(AuthorizationError)
  })

  it("requireRole passes for correct role", () => {
    const ctx = createAuthContext("user1", { role: "admin" })

    expect(() => ctx.requireRole("admin")).not.toThrow()
  })

  it("hasClaim returns true for existing claim", () => {
    const ctx = createAuthContext("user1", { role: "admin", org: "acme" })

    expect(ctx.hasClaim("role")).toBe(true)
    expect(ctx.hasClaim("org")).toBe(true)
    expect(ctx.hasClaim("missing")).toBe(false)
  })
})

describe("jwtProvider", () => {
  const secret = "test-secret-key-12345"

  it("verifies a valid JWT", async () => {
    const provider = jwtProvider({ issuer: "test", audience: "app", secret })
    const token = createTestJwt(
      {
        sub: "user123",
        iss: "test",
        aud: "app",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
    )

    const result = await provider.verify(token)
    expect(result.userId).toBe("user123")
  })

  it("rejects an expired JWT", async () => {
    const provider = jwtProvider({ issuer: "test", audience: "app", secret })
    const token = createTestJwt(
      {
        sub: "user123",
        iss: "test",
        aud: "app",
        exp: Math.floor(Date.now() / 1000) - 100,
      },
      secret,
    )

    await expect(provider.verify(token)).rejects.toThrow("expired")
  })

  it("rejects invalid signature", async () => {
    const provider = jwtProvider({ issuer: "test", audience: "app", secret })
    const token = createTestJwt({ sub: "user123", iss: "test", aud: "app" }, "wrong-secret")

    await expect(provider.verify(token)).rejects.toThrow("signature")
  })

  it("rejects malformed token", async () => {
    const provider = jwtProvider({ issuer: "test", audience: "app", secret })

    await expect(provider.verify("not-a-jwt")).rejects.toThrow("format")
  })

  it("rejects unsupported algorithm", async () => {
    const provider = jwtProvider({ secret })
    // Create a token with alg: "none"
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url")
    const token = `${header}.${body}.fakesig`

    await expect(provider.verify(token)).rejects.toThrow("Unsupported")
  })

  it("supports audience as array", async () => {
    const provider = jwtProvider({ audience: "app", secret })
    const token = createTestJwt(
      {
        sub: "user1",
        aud: ["app", "other"],
      },
      secret,
    )

    const result = await provider.verify(token)
    expect(result.userId).toBe("user1")
  })
})

describe("jwtProvider RS256", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })

  function createRS256Jwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
    const data = `${header}.${body}`

    const signer = createSign("RSA-SHA256")
    signer.update(data)
    const signature = signer.sign(privateKey as string, "base64url")

    return `${data}.${signature}`
  }

  it("verifies a valid RS256 JWT with publicKey", async () => {
    const provider = jwtProvider({ publicKey: publicKey as string })
    const token = createRS256Jwt({
      sub: "user-rs256",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    const result = await provider.verify(token)
    expect(result.userId).toBe("user-rs256")
  })

  it("rejects RS256 JWT with wrong key", async () => {
    const { publicKey: otherKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    })

    const provider = jwtProvider({ publicKey: otherKey as string })
    const token = createRS256Jwt({ sub: "user1" })

    await expect(provider.verify(token)).rejects.toThrow("signature")
  })

  it("validates issuer and audience for RS256", async () => {
    const provider = jwtProvider({
      publicKey: publicKey as string,
      issuer: "my-issuer",
      audience: "my-app",
    })

    const validToken = createRS256Jwt({
      sub: "user1",
      iss: "my-issuer",
      aud: "my-app",
    })
    const result = await provider.verify(validToken)
    expect(result.userId).toBe("user1")

    const badIssuer = createRS256Jwt({
      sub: "user1",
      iss: "wrong",
      aud: "my-app",
    })
    await expect(provider.verify(badIssuer)).rejects.toThrow("issuer")
  })
})

describe("tokenProvider", () => {
  it("delegates to verify function", async () => {
    const provider = tokenProvider(async (token) => {
      if (token === "valid-key") return { userId: "u1", claims: { plan: "pro" } }
      throw new Error("Invalid key")
    })

    const result = await provider.verify("valid-key")
    expect(result.userId).toBe("u1")
    expect(result.claims.plan).toBe("pro")
  })
})

describe("defineRlsPolicy", () => {
  it("creates a filter policy", () => {
    const policy = defineRlsPolicy<{ userId: string }>("tasks", (auth, row) => {
      return row.userId === auth.userId
    })

    const auth = createAuthContext("user1")
    expect(policy.filter(auth, { userId: "user1" })).toBe(true)
    expect(policy.filter(auth, { userId: "user2" })).toBe(false)
  })
})
