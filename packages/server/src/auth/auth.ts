/**
 * Authentication context available in all server functions.
 */

export interface AuthContext {
  userId: string | null
  claims: Record<string, unknown>

  /** Throws if no authenticated user */
  requireUser(): string

  /** Checks if user has a specific role */
  requireRole(role: string): void
}

export interface AuthProvider {
  verify(token: string): Promise<{ userId: string; claims: Record<string, unknown> }>
}

export interface JwtProviderOptions {
  issuer: string
  audience: string
  jwksUrl?: string
  secret?: string
}

/**
 * Create a JWT auth provider.
 */
export function jwtProvider(_options: JwtProviderOptions): AuthProvider {
  return {
    async verify(_token: string) {
      // In a real implementation, this would verify the JWT
      // For Phase 1, we provide the interface and a basic implementation
      throw new Error("JWT verification not implemented - configure a custom provider")
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

export function createAuthContext(
  userId: string | null,
  claims: Record<string, unknown> = {},
): AuthContext {
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
