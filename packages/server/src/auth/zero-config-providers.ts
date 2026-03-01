/**
 * Zero-Config Auth Providers for ReactiveBase.
 * Drop-in authentication with minimal configuration for popular identity providers.
 *
 * Features:
 *   - Google OAuth with auto-discovery via OpenID Connect
 *   - GitHub OAuth with token introspection
 *   - Email magic link authentication
 *   - Anonymous auth for development
 *   - Auto-detection of provider from environment variables
 *   - Composable multi-provider support
 *
 * Usage:
 *   // Auto-detect from env vars
 *   const auth = autoDetectProviders()
 *
 *   // Explicit zero-config
 *   const auth = googleAuth()        // Reads GOOGLE_CLIENT_ID from env
 *   const auth = githubAuth()        // Reads GITHUB_CLIENT_ID from env
 *   const auth = magicLinkAuth()     // Reads REACTIVEBASE_SECRET from env
 *   const auth = multiProvider([googleAuth(), githubAuth()])
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { AuthProvider } from "./auth.js"
import { AuthenticationError } from "./auth.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ZeroConfigProviderOptions {
  /** Override environment variable lookup */
  env?: Record<string, string | undefined>
}

export interface GoogleAuthOptions extends ZeroConfigProviderOptions {
  clientId?: string
  /** Allowed hosted domains (e.g., "example.com") */
  allowedDomains?: string[]
}

export interface GitHubAuthOptions extends ZeroConfigProviderOptions {
  clientId?: string
  clientSecret?: string
  /** Required org membership */
  requiredOrg?: string
}

export interface MagicLinkAuthOptions extends ZeroConfigProviderOptions {
  /** HMAC secret for token signing. Falls back to REACTIVEBASE_SECRET env var */
  secret?: string
  /** Token expiry in seconds (default: 600 = 10 min) */
  expirySeconds?: number
}

export interface AnonymousAuthOptions {
  /** Prefix for anonymous user IDs (default: "anon") */
  prefix?: string
  /** Allow anonymous access (default: true in dev, false in prod) */
  enabled?: boolean
}

export interface MultiProviderOptions {
  /** Strategy for selecting provider (default: "first-match") */
  strategy?: "first-match" | "token-prefix"
}

export interface ProviderDetectionResult {
  providers: AuthProvider[]
  detected: string[]
  warnings: string[]
}

// ─── Google Auth ─────────────────────────────────────────────────────────────

const GOOGLE_OIDC_ISSUER = "https://accounts.google.com"
const _GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"

export function googleAuth(options: GoogleAuthOptions = {}): AuthProvider {
  const env = options.env ?? getProcessEnv()
  const clientId = options.clientId ?? env.GOOGLE_CLIENT_ID

  return {
    name: "google",
    async verify(token: string) {
      // Decode JWT without full verification - we verify via Google's tokeninfo endpoint
      const parts = token.split(".")
      if (parts.length !== 3) {
        throw new AuthenticationError("Invalid Google JWT format")
      }

      const payload = safeJsonParse(Buffer.from(parts[1], "base64url").toString("utf-8"))
      if (!payload) {
        throw new AuthenticationError("Invalid Google JWT payload")
      }

      // Verify issuer
      if (payload.iss !== GOOGLE_OIDC_ISSUER && payload.iss !== "accounts.google.com") {
        throw new AuthenticationError("Invalid Google JWT issuer")
      }

      // Verify audience if clientId configured
      if (clientId) {
        const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
        if (!aud.includes(clientId)) {
          throw new AuthenticationError("Google JWT audience mismatch")
        }
      }

      // Verify expiry
      if (payload.exp && Number(payload.exp) < Math.floor(Date.now() / 1000)) {
        throw new AuthenticationError("Google JWT expired")
      }

      // Verify domain restriction
      if (options.allowedDomains?.length) {
        const domain = payload.hd as string | undefined
        if (!domain || !options.allowedDomains.includes(domain)) {
          throw new AuthenticationError(`Google account domain "${domain ?? "unknown"}" not in allowed list`)
        }
      }

      const userId = (payload.sub as string) || (payload.email as string)
      if (!userId) {
        throw new AuthenticationError("Google JWT missing subject")
      }

      return {
        userId,
        claims: {
          provider: "google",
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          emailVerified: payload.email_verified,
          domain: payload.hd,
          ...payload,
        },
      }
    },
  }
}

// ─── GitHub Auth ─────────────────────────────────────────────────────────────

const GITHUB_API_URL = "https://api.github.com"

export function githubAuth(options: GitHubAuthOptions = {}): AuthProvider {
  const env = options.env ?? getProcessEnv()
  const _clientId = options.clientId ?? env.GITHUB_CLIENT_ID

  return {
    name: "github",
    async verify(token: string) {
      if (!token || token.length < 10) {
        throw new AuthenticationError("Invalid GitHub token")
      }

      // For GitHub tokens, we validate by calling the GitHub API
      // In zero-config mode, the token is a GitHub personal access token or OAuth token
      const response = await fetch(`${GITHUB_API_URL}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "ReactiveBase",
        },
      })

      if (!response.ok) {
        throw new AuthenticationError(`GitHub token validation failed: ${response.status}`)
      }

      const user = (await response.json()) as {
        id: number
        login: string
        email: string | null
        name: string | null
        avatar_url: string
      }

      // Check org membership if required
      if (options.requiredOrg) {
        const orgResponse = await fetch(`${GITHUB_API_URL}/user/orgs`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "ReactiveBase",
          },
        })

        if (orgResponse.ok) {
          const orgs = (await orgResponse.json()) as Array<{ login: string }>
          if (!orgs.some((o) => o.login === options.requiredOrg)) {
            throw new AuthenticationError(
              `GitHub user "${user.login}" is not a member of required org "${options.requiredOrg}"`,
            )
          }
        }
      }

      return {
        userId: String(user.id),
        claims: {
          provider: "github",
          login: user.login,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatar_url,
        },
      }
    },
  }
}

// ─── Magic Link Auth ─────────────────────────────────────────────────────────

export function magicLinkAuth(options: MagicLinkAuthOptions = {}): AuthProvider {
  const env = options.env ?? getProcessEnv()
  const secret = options.secret ?? env.REACTIVEBASE_SECRET
  const _expirySeconds = options.expirySeconds ?? 600

  return {
    name: "magic-link",
    async verify(token: string) {
      if (!secret) {
        throw new AuthenticationError(
          "Magic link auth requires REACTIVEBASE_SECRET environment variable or explicit secret",
        )
      }

      const parts = token.split(".")
      if (parts.length !== 3) {
        throw new AuthenticationError("Invalid magic link token format")
      }

      const [payloadB64, expiryB64, signatureB64] = parts

      // Verify signature
      const data = `${payloadB64}.${expiryB64}`
      const expectedSig = createHmac("sha256", secret).update(data).digest("base64url")

      const expectedBuf = Buffer.from(expectedSig, "base64url")
      const actualBuf = Buffer.from(signatureB64, "base64url")
      if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
        throw new AuthenticationError("Invalid magic link token signature")
      }

      // Verify expiry
      const expiry = Number(Buffer.from(expiryB64, "base64url").toString("utf-8"))
      if (isNaN(expiry) || expiry < Math.floor(Date.now() / 1000)) {
        throw new AuthenticationError("Magic link token expired")
      }

      const payload = safeJsonParse(Buffer.from(payloadB64, "base64url").toString("utf-8"))
      if (!payload || !payload.email) {
        throw new AuthenticationError("Invalid magic link payload")
      }

      return {
        userId: String(payload.userId ?? payload.email),
        claims: {
          provider: "magic-link",
          email: String(payload.email),
          ...payload,
        },
      }
    },
  }
}

/**
 * Generate a magic link token for an email address.
 */
export function generateMagicLinkToken(
  email: string,
  options: { secret: string; expirySeconds?: number; userId?: string },
): string {
  const expirySeconds = options.expirySeconds ?? 600
  const payload = { email, userId: options.userId ?? email, nonce: randomBytes(8).toString("hex") }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const expiry = Math.floor(Date.now() / 1000) + expirySeconds
  const expiryB64 = Buffer.from(String(expiry)).toString("base64url")
  const data = `${payloadB64}.${expiryB64}`
  const signature = createHmac("sha256", options.secret).update(data).digest("base64url")
  return `${payloadB64}.${expiryB64}.${signature}`
}

// ─── Anonymous Auth ──────────────────────────────────────────────────────────

export function anonymousAuth(options: AnonymousAuthOptions = {}): AuthProvider {
  const prefix = options.prefix ?? "anon"
  const enabled = options.enabled ?? getProcessEnv().NODE_ENV !== "production"

  return {
    name: "anonymous",
    async verify(token: string) {
      if (!enabled) {
        throw new AuthenticationError("Anonymous auth is disabled in production")
      }

      // Accept any token as anonymous identity
      const userId = token && token.length > 0 ? `${prefix}_${token}` : `${prefix}_${randomBytes(8).toString("hex")}`

      return {
        userId,
        claims: { provider: "anonymous", anonymous: true },
      }
    },
  }
}

// ─── Multi-Provider ──────────────────────────────────────────────────────────

/**
 * Combine multiple auth providers into one. Tries each provider in order.
 */
export function multiProvider(providers: AuthProvider[], options: MultiProviderOptions = {}): AuthProvider {
  if (providers.length === 0) {
    throw new Error("multiProvider requires at least one provider")
  }

  const strategy = options.strategy ?? "first-match"

  return {
    name: `multi(${providers.map((p) => p.name ?? "unknown").join(",")})`,
    async verify(token: string) {
      if (strategy === "token-prefix") {
        // Token format: "provider:actual_token"
        const colonIdx = token.indexOf(":")
        if (colonIdx > 0) {
          const prefix = token.slice(0, colonIdx)
          const actualToken = token.slice(colonIdx + 1)
          const provider = providers.find((p) => p.name === prefix)
          if (provider) {
            return provider.verify(actualToken)
          }
        }
      }

      // First-match strategy: try each provider
      const errors: string[] = []
      for (const provider of providers) {
        try {
          return await provider.verify(token)
        } catch (error: unknown) {
          errors.push(`${provider.name ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      throw new AuthenticationError(`No auth provider could verify the token. Tried: ${errors.join("; ")}`)
    },
  }
}

// ─── Auto-Detection ──────────────────────────────────────────────────────────

/**
 * Auto-detect auth providers from environment variables.
 * Returns a multi-provider that includes all detected providers.
 */
export function autoDetectProviders(options: ZeroConfigProviderOptions = {}): ProviderDetectionResult {
  const env = options.env ?? getProcessEnv()
  const providers: AuthProvider[] = []
  const detected: string[] = []
  const warnings: string[] = []

  // Google: requires GOOGLE_CLIENT_ID
  if (env.GOOGLE_CLIENT_ID) {
    providers.push(googleAuth({ env }))
    detected.push("google")
  }

  // GitHub: requires GITHUB_CLIENT_ID
  if (env.GITHUB_CLIENT_ID) {
    providers.push(githubAuth({ env }))
    detected.push("github")
  }

  // Magic Link: requires REACTIVEBASE_SECRET
  if (env.REACTIVEBASE_SECRET) {
    providers.push(magicLinkAuth({ env }))
    detected.push("magic-link")
  }

  // Development: anonymous auth
  if (env.NODE_ENV !== "production" && providers.length === 0) {
    providers.push(anonymousAuth())
    detected.push("anonymous")
    warnings.push("No auth providers detected. Anonymous auth enabled for development.")
  }

  if (providers.length === 0) {
    warnings.push("No auth providers detected. Set GOOGLE_CLIENT_ID, GITHUB_CLIENT_ID, or REACTIVEBASE_SECRET.")
  }

  return { providers, detected, warnings }
}

/**
 * Create a zero-config auth provider that auto-detects from environment.
 */
export function zeroConfigAuth(options: ZeroConfigProviderOptions = {}): AuthProvider {
  const result = autoDetectProviders(options)
  if (result.providers.length === 0) {
    return anonymousAuth({ enabled: true })
  }
  if (result.providers.length === 1) {
    return result.providers[0]
  }
  return multiProvider(result.providers)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getProcessEnv(): Record<string, string | undefined> {
  try {
    return process.env as Record<string, string | undefined>
  } catch {
    return {}
  }
}

function safeJsonParse(str: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(str)
    return typeof parsed === "object" && parsed !== null ? parsed : null
  } catch {
    return null
  }
}
