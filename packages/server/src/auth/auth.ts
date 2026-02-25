/**
 * Authentication context available in all server functions.
 */

import { createHmac, createPublicKey, createVerify, timingSafeEqual, type KeyObject } from "node:crypto"

export interface AuthContext {
  userId: string | null
  claims: Record<string, unknown>

  /** Throws if no authenticated user */
  requireUser(): string

  /** Checks if user has a specific role */
  requireRole(role: string): void

  /** Checks if user has a specific claim */
  hasClaim(key: string): boolean
}

export interface AuthProvider {
  name?: string
  verify(token: string): Promise<{ userId: string; claims: Record<string, unknown> }>
}

export interface JwtProviderOptions {
  issuer?: string
  audience?: string
  /** HMAC secret for HS256 */
  secret?: string
  /** PEM-encoded public key for RS256 */
  publicKey?: string
  /** JWKS endpoint URL for dynamic key fetching (RS256) */
  jwksUrl?: string
  /** Cache TTL for JWKS keys in ms (default: 600_000 = 10min) */
  jwksCacheTtl?: number
}

/**
 * Row-level security policy definition.
 */
export interface RlsPolicy<TRow = Record<string, unknown>> {
  table: string
  filter: (auth: AuthContext, row: TRow) => boolean
}

/**
 * Create a JWT auth provider supporting HS256 (secret) and RS256 (publicKey/JWKS).
 */
export function jwtProvider(options: JwtProviderOptions): AuthProvider {
  let jwksCache: JwksCache | null = null

  if (options.jwksUrl) {
    jwksCache = new JwksCache(options.jwksUrl, options.jwksCacheTtl ?? 600_000)
  }

  return {
    name: "jwt",
    async verify(token: string) {
      const parts = token.split(".")
      if (parts.length !== 3) {
        throw new AuthenticationError("Invalid JWT format")
      }

      const [headerB64, payloadB64, signatureB64] = parts

      const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8"))
      const alg = header.alg as string

      // Enforce algorithm allowlist based on configured verification method
      const allowedAlgorithms: string[] = []
      if (options.secret) allowedAlgorithms.push("HS256")
      if (options.publicKey || options.jwksUrl) allowedAlgorithms.push("RS256")
      if (!allowedAlgorithms.includes(alg)) {
        throw new AuthenticationError(`JWT algorithm "${alg}" not allowed; expected ${allowedAlgorithms.join(" or ")}`)
      }

      const data = `${headerB64}.${payloadB64}`

      // Verify signature based on algorithm
      if (alg === "HS256") {
        if (!options.secret) {
          throw new AuthenticationError("JWT secret required for HS256")
        }
        const expectedSig = createHmac("sha256", options.secret).update(data).digest("base64url")

        const expectedBuf = Buffer.from(expectedSig, "base64url")
        const actualBuf = Buffer.from(signatureB64, "base64url")
        if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
          throw new AuthenticationError("Invalid JWT signature")
        }
      } else if (alg === "RS256") {
        let publicKey: KeyObject | string | undefined

        if (options.publicKey) {
          publicKey = options.publicKey
        } else if (jwksCache) {
          const kid = header.kid as string | undefined
          publicKey = await jwksCache.getKey(kid)
        }

        if (!publicKey) {
          throw new AuthenticationError("No public key available for RS256 verification")
        }

        const signatureBuffer = Buffer.from(signatureB64, "base64url")
        const verifier = createVerify("RSA-SHA256")
        verifier.update(data)
        const isValid = verifier.verify(publicKey, signatureBuffer)

        if (!isValid) {
          throw new AuthenticationError("Invalid JWT signature")
        }
      } else {
        throw new AuthenticationError(`Unsupported JWT algorithm: ${alg}`)
      }

      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"))

      // Validate standard claims
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new AuthenticationError("JWT token expired")
      }

      if (options.issuer && payload.iss !== options.issuer) {
        throw new AuthenticationError("Invalid JWT issuer")
      }

      if (options.audience) {
        const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
        if (!aud.includes(options.audience)) {
          throw new AuthenticationError("Invalid JWT audience")
        }
      }

      const userId = payload.sub || payload.userId
      if (!userId) {
        throw new AuthenticationError("JWT missing subject (sub) claim")
      }

      return { userId, claims: payload }
    },
  }
}

/**
 * Create a custom auth provider.
 */
export function customProvider(
  verifyFn: (request: { headers: Map<string, string> }) => Promise<{
    userId: string
    role?: string
    [key: string]: unknown
  }>,
): AuthProvider {
  return {
    name: "custom",
    async verify(token: string) {
      const headers = new Map<string, string>()
      headers.set("Authorization", token)
      const result = await verifyFn({ headers })
      return {
        userId: result.userId,
        claims: result,
      }
    },
  }
}

/**
 * Create a token-based auth provider (API keys, bearer tokens).
 */
export function tokenProvider(
  verifyFn: (token: string) => Promise<{ userId: string; claims?: Record<string, unknown> }>,
): AuthProvider {
  return {
    name: "token",
    async verify(token: string) {
      const result = await verifyFn(token)
      return { userId: result.userId, claims: result.claims ?? {} }
    },
  }
}

/**
 * Define a row-level security policy.
 */
export function defineRlsPolicy<TRow = Record<string, unknown>>(
  table: string,
  filter: (auth: AuthContext, row: TRow) => boolean,
): RlsPolicy<TRow> {
  return { table, filter }
}

export function createAuthContext(userId: string | null, claims: Record<string, unknown> = {}): AuthContext {
  return {
    userId,
    claims,
    requireUser() {
      if (!userId) {
        throw new AuthenticationError("Authentication required")
      }
      return userId
    },
    requireRole(role: string) {
      if (!userId) {
        throw new AuthenticationError("Authentication required")
      }
      if (claims.role !== role) {
        throw new AuthorizationError(`Required role: ${role}`)
      }
    },
    hasClaim(key: string) {
      return key in claims
    },
  }
}

export class AuthenticationError extends Error {
  readonly code = "UNAUTHENTICATED"
  readonly statusCode = 401

  constructor(message: string) {
    super(message)
    this.name = "AuthenticationError"
  }
}

export class AuthorizationError extends Error {
  readonly code = "UNAUTHORIZED"
  readonly statusCode = 403

  constructor(message: string) {
    super(message)
    this.name = "AuthorizationError"
  }
}

// --- JWKS Cache ---

interface JwksKey {
  kid?: string
  kty: string
  n: string
  e: string
  alg?: string
  use?: string
}

/**
 * Caches JWKS keys fetched from a remote endpoint.
 * Automatically refreshes after TTL expires.
 */
class JwksCache {
  private keys: Map<string, KeyObject> = new Map()
  private lastFetch = 0

  constructor(
    private jwksUrl: string,
    private ttl: number,
  ) {}

  async getKey(kid?: string): Promise<KeyObject> {
    if (Date.now() - this.lastFetch > this.ttl || this.keys.size === 0) {
      await this.refresh()
    }

    if (kid) {
      const key = this.keys.get(kid)
      if (!key) {
        // Force refresh in case keys rotated
        await this.refresh()
        const retryKey = this.keys.get(kid)
        if (!retryKey) {
          throw new AuthenticationError(`JWKS key not found for kid: ${kid}`)
        }
        return retryKey
      }
      return key
    }

    // If no kid specified, use the first signing key
    const firstKey = this.keys.values().next().value
    if (!firstKey) {
      throw new AuthenticationError("No JWKS keys available")
    }
    return firstKey
  }

  private async refresh(): Promise<void> {
    const response = await fetch(this.jwksUrl)
    if (!response.ok) {
      throw new AuthenticationError(`Failed to fetch JWKS: ${response.status}`)
    }

    const jwks = (await response.json()) as { keys: JwksKey[] }
    this.keys.clear()

    for (const jwk of jwks.keys) {
      if (jwk.kty !== "RSA") continue
      if (jwk.use && jwk.use !== "sig") continue

      try {
        const keyObject = createPublicKey({
          key: {
            kty: jwk.kty,
            n: jwk.n,
            e: jwk.e,
          },
          format: "jwk",
        })
        const keyId = jwk.kid ?? `key_${this.keys.size}`
        this.keys.set(keyId, keyObject)
      } catch {
        // Skip malformed keys
      }
    }

    this.lastFetch = Date.now()
  }
}
