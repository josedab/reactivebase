# ADR-006: Authentication Architecture — JWT + JWKS + Custom Providers

## Status

Accepted

## Context

ReactiveBase needs a flexible authentication system that supports:

1. Stateless token verification for WebSocket and HTTP connections
2. Third-party auth providers (Clerk, Auth0, Firebase Auth, Supabase Auth)
3. Custom authentication logic for self-hosted deployments
4. Row-level security (RLS) policies that reference the authenticated user

The auth system must be zero-config for development (no auth required) while supporting production-grade JWT verification with key rotation.

## Decision

We implement a layered authentication architecture in `packages/server/src/auth/`:

- **JWT verification** supports both HS256 (shared secret via `JWT_SECRET`) and RS256 (asymmetric keys via JWKS endpoint)
- **JWKS auto-discovery** fetches and caches public keys from `/.well-known/jwks.json` endpoints, with automatic rotation on key ID mismatch
- **Auth context** — every `query()`, `mutation()`, and `action()` receives `ctx.auth` containing the verified JWT claims (userId, roles, custom claims)
- **Custom providers** — a `defineAuthProvider()` API allows plugging in arbitrary authentication logic that produces the same `AuthContext` shape
- **No-auth mode** — when no auth is configured, `ctx.auth` is `null` and all permission checks are skipped (development only)

RLS policies reference `ctx.auth` fields directly:

```ts
allow("read", "documents", (ctx, doc) => doc.ownerId === ctx.auth.userId)
```

## Consequences

### Positive

- HS256 provides simple setup for development and single-server deployments
- JWKS support enables seamless integration with any OIDC-compliant provider
- The `AuthContext` abstraction decouples permission checks from the specific auth mechanism
- Custom providers allow self-hosted deployments to use session-based auth or API keys

### Negative

- JWKS fetching introduces a network dependency on the identity provider
- Supporting multiple JWT algorithms adds complexity to token verification
- No-auth mode in development can mask permission bugs that only appear in production
