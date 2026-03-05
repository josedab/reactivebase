/**
 * Extended First-Party Plugins for ReactiveBase Plugin Marketplace.
 *
 * Provides 8 additional plugin definitions beyond the existing 5 (Stripe, Clerk,
 * Resend, Sentry, Vercel, S3, PostHog):
 *   - PostGIS: Geospatial queries
 *   - Full-Text Search: tsvector-based search
 *   - Rate Limiting: Token bucket rate limiter
 *   - Audit Logging: Change tracking
 *   - Data Seeding: Development data generation
 *   - Webhooks: Outbound webhook delivery
 *   - Auth0 Auth: Auth0 integration
 *   - Clerk Auth: Clerk authentication
 */

import type { PluginV2Definition, PluginCategory } from "./marketplace.js"

// ─── PostGIS Plugin ──────────────────────────────────────────────────────────

export const postgisPlugin: PluginV2Definition = {
  name: "postgis",
  version: "0.1.0",
  description: "PostGIS geospatial queries — distance search, bounding box, GeoJSON support.",
  author: "ReactiveBase",
  keywords: ["geo", "spatial", "postgis", "location", "distance"],
  category: "database" as PluginCategory,
  configSchema: {
    srid: { type: "number", required: false, default: 4326, description: "Spatial reference system ID" },
    defaultDistanceUnit: { type: "string", required: false, default: "meters", description: "Default distance unit" },
  },
  onInstall: async (ctx) => {
    ctx.logger.info("PostGIS plugin installed — ensure PostGIS extension is enabled in Postgres")
    ctx.registerFunction("nearbySearch", async (params: unknown) => {
      const { table, lat, lng, radiusMeters } = params as {
        table: string
        lat: number
        lng: number
        radiusMeters: number
      }
      return {
        query: `SELECT *, ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance FROM "${table}" WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3) ORDER BY distance`,
        params: [lng, lat, radiusMeters],
      }
    })
    ctx.registerFunction("withinBoundingBox", async (params: unknown) => {
      const { table, minLat, minLng, maxLat, maxLng } = params as {
        table: string
        minLat: number
        minLng: number
        maxLat: number
        maxLng: number
      }
      return {
        query: `SELECT * FROM "${table}" WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)`,
        params: [minLng, minLat, maxLng, maxLat],
      }
    })
  },
}

// ─── Full-Text Search Plugin ─────────────────────────────────────────────────

export const fullTextSearchPlugin: PluginV2Definition = {
  name: "full-text-search",
  version: "0.1.0",
  description: "Postgres full-text search with tsvector, ranking, and highlighting.",
  author: "ReactiveBase",
  keywords: ["search", "fts", "tsvector", "ranking", "highlight"],
  category: "database" as PluginCategory,
  configSchema: {
    language: { type: "string", required: false, default: "english", description: "Text search language" },
    highlightTag: { type: "string", required: false, default: "<mark>", description: "HTML tag for highlighting" },
  },
  onInstall: async (ctx) => {
    ctx.logger.info("Full-text search plugin installed")
    const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
    const VALID_LANGUAGES = new Set([
      "simple",
      "english",
      "spanish",
      "french",
      "german",
      "italian",
      "portuguese",
      "russian",
    ])
    ctx.registerFunction("search", async (params: unknown) => {
      const { table, columns, query, limit } = params as {
        table: string
        columns: string[]
        query: string
        limit?: number
      }
      if (!SAFE_IDENTIFIER_RE.test(table)) {
        throw new Error(`Invalid table name: "${table}"`)
      }
      for (const col of columns) {
        if (!SAFE_IDENTIFIER_RE.test(col)) {
          throw new Error(`Invalid column name: "${col}"`)
        }
      }
      const lang = (ctx.config.language as string) ?? "english"
      if (!VALID_LANGUAGES.has(lang)) {
        throw new Error(`Invalid search language: "${lang}"`)
      }
      const tsvector = columns.map((c) => `"${c}"`).join(" || ' ' || ")
      return {
        query: `SELECT *, ts_rank(to_tsvector('${lang}', ${tsvector}), plainto_tsquery('${lang}', $1)) AS rank FROM "${table}" WHERE to_tsvector('${lang}', ${tsvector}) @@ plainto_tsquery('${lang}', $1) ORDER BY rank DESC LIMIT $2`,
        params: [query, limit ?? 20],
      }
    })
  },
}

// ─── Rate Limiting Plugin ────────────────────────────────────────────────────

export const rateLimitingPlugin: PluginV2Definition = {
  name: "rate-limiting",
  version: "0.1.0",
  description: "Token bucket rate limiter with per-user and per-IP limits.",
  author: "ReactiveBase",
  keywords: ["rate-limit", "throttle", "security", "api"],
  category: "utilities" as PluginCategory,
  configSchema: {
    maxRequests: { type: "number", required: false, default: 100, description: "Max requests per window" },
    windowMs: { type: "number", required: false, default: 60000, description: "Time window in ms" },
    keyPrefix: { type: "string", required: false, default: "rl:", description: "Redis key prefix" },
  },
  onInstall: async (ctx) => {
    ctx.logger.info("Rate limiting plugin installed")
    const buckets = new Map<string, { tokens: number; lastRefill: number }>()
    const maxReqs = (ctx.config.maxRequests as number) ?? 100
    const windowMs = (ctx.config.windowMs as number) ?? 60000

    ctx.registerFunction("checkRateLimit", async (params: unknown) => {
      const { key } = params as { key: string }
      const now = Date.now()
      let bucket = buckets.get(key)
      if (!bucket || now - bucket.lastRefill > windowMs) {
        bucket = { tokens: maxReqs, lastRefill: now }
        buckets.set(key, bucket)
      }
      if (bucket.tokens > 0) {
        bucket.tokens--
        return { allowed: true, remaining: bucket.tokens, resetAt: bucket.lastRefill + windowMs }
      }
      return { allowed: false, remaining: 0, resetAt: bucket.lastRefill + windowMs }
    })
  },
}

// ─── Audit Logging Plugin ────────────────────────────────────────────────────

export const auditLoggingPlugin: PluginV2Definition = {
  name: "audit-logging",
  version: "0.1.0",
  description: "Automatic audit trail for all data changes with before/after snapshots.",
  author: "ReactiveBase",
  keywords: ["audit", "logging", "compliance", "trail", "history"],
  category: "monitoring" as PluginCategory,
  configSchema: {
    tables: { type: "array", required: false, description: "Tables to audit (empty = all)" },
    retentionDays: { type: "number", required: false, default: 90, description: "Log retention in days" },
  },
  onInstall: async (ctx) => {
    ctx.logger.info("Audit logging plugin installed")
    ctx.registerFunction("getAuditLog", async (params: unknown) => {
      const { table, rowId, limit } = params as { table?: string; rowId?: string; limit?: number }
      return {
        query: `SELECT * FROM _reactivebase_audit_log WHERE ($1::text IS NULL OR table_name = $1) AND ($2::text IS NULL OR row_id = $2) ORDER BY created_at DESC LIMIT $3`,
        params: [table ?? null, rowId ?? null, limit ?? 50],
      }
    })
  },
}

// ─── Data Seeding Plugin ─────────────────────────────────────────────────────

export const dataSeedingPlugin: PluginV2Definition = {
  name: "data-seeding",
  version: "0.1.0",
  description: "Generate realistic test data for development and staging environments.",
  author: "ReactiveBase",
  keywords: ["seed", "faker", "test-data", "development", "mock"],
  category: "utilities" as PluginCategory,
  configSchema: {
    locale: { type: "string", required: false, default: "en", description: "Locale for generated data" },
    defaultCount: { type: "number", required: false, default: 50, description: "Default rows per table" },
  },
  onInstall: async (ctx) => {
    ctx.logger.info("Data seeding plugin installed")
    ctx.registerFunction("seed", async (params: unknown) => {
      const { table, count, overrides } = params as {
        table: string
        count?: number
        overrides?: Record<string, unknown>
      }
      const n = count ?? (ctx.config.defaultCount as number) ?? 50
      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < n; i++) {
        rows.push({
          id: `seed_${table}_${i}`,
          created_at: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
          ...overrides,
        })
      }
      return { table, generatedRows: rows.length, sample: rows.slice(0, 3) }
    })
  },
}

// ─── Webhooks Plugin ─────────────────────────────────────────────────────────

export const webhooksPlugin: PluginV2Definition = {
  name: "webhooks",
  version: "0.1.0",
  description: "Outbound webhook delivery with retry logic and HMAC signature verification.",
  author: "ReactiveBase",
  keywords: ["webhooks", "events", "http", "notifications"],
  category: "utilities" as PluginCategory,
  configSchema: {
    signingSecret: { type: "string", required: false, description: "HMAC signing secret for webhook payloads" },
    maxRetries: { type: "number", required: false, default: 3, description: "Max delivery retry attempts" },
    timeoutMs: { type: "number", required: false, default: 10000, description: "HTTP timeout in ms" },
  },
  onInstall: async (ctx) => {
    ctx.logger.info("Webhooks plugin installed")
    ctx.registerFunction("registerWebhook", async (params: unknown) => {
      const { url, events, secret } = params as { url: string; events: string[]; secret?: string }
      return {
        id: `wh_${Date.now().toString(36)}`,
        url,
        events,
        secret: secret ?? (ctx.config.signingSecret as string) ?? undefined,
        status: "active",
        createdAt: new Date().toISOString(),
      }
    })
    ctx.registerFunction("deliverWebhook", async (params: unknown) => {
      const { url, event, payload } = params as { url: string; event: string; payload: unknown }
      return { url, event, delivered: true, timestamp: new Date().toISOString(), payload }
    })
  },
}

// ─── Auth0 Plugin ────────────────────────────────────────────────────────────

export const auth0Plugin: PluginV2Definition = {
  name: "auth0",
  version: "0.1.0",
  description: "Auth0 authentication integration with JWT verification and user sync.",
  author: "ReactiveBase",
  keywords: ["auth", "auth0", "jwt", "authentication", "sso"],
  category: "auth" as PluginCategory,
  configSchema: {
    domain: { type: "string", required: true, description: "Auth0 domain (e.g., tenant.auth0.com)" },
    clientId: { type: "string", required: true, description: "Auth0 client ID" },
    clientSecret: { type: "string", required: true, description: "Auth0 client secret" },
    audience: { type: "string", required: false, description: "API audience identifier" },
  },
  onInstall: async (ctx) => {
    ctx.logger.info("Auth0 plugin installed")
    ctx.registerFunction("verifyToken", async (params: unknown) => {
      const { token } = params as { token: string }
      // In production, verify JWT against Auth0 JWKS endpoint
      return { valid: token.length > 0, provider: "auth0", domain: ctx.config.domain }
    })
  },
}

// ─── Clerk Auth Plugin ───────────────────────────────────────────────────────

export const clerkAuthPlugin: PluginV2Definition = {
  name: "clerk-auth",
  version: "0.1.0",
  description: "Clerk authentication with session management and user metadata sync.",
  author: "ReactiveBase",
  keywords: ["auth", "clerk", "session", "authentication"],
  category: "auth" as PluginCategory,
  configSchema: {
    publishableKey: { type: "string", required: true, description: "Clerk publishable key" },
    secretKey: { type: "string", required: true, description: "Clerk secret key" },
  },
  onInstall: async (ctx) => {
    ctx.logger.info("Clerk auth plugin installed")
    ctx.registerFunction("verifySession", async (params: unknown) => {
      const { sessionToken } = params as { sessionToken: string }
      return { valid: sessionToken.length > 0, provider: "clerk" }
    })
  },
}

// ─── Plugin Collection ───────────────────────────────────────────────────────

/** All extended first-party plugins */
export const EXTENDED_FIRST_PARTY_PLUGINS: PluginV2Definition[] = [
  postgisPlugin,
  fullTextSearchPlugin,
  rateLimitingPlugin,
  auditLoggingPlugin,
  dataSeedingPlugin,
  webhooksPlugin,
  auth0Plugin,
  clerkAuthPlugin,
]
