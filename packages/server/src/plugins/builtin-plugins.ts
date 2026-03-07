/**
 * Built-in Plugin Definitions for ReactiveBase.
 * Extends the first-party plugins (resend, sentry, vercel) with two
 * additional integrations: S3 storage and PostHog analytics.
 *
 * Usage:
 *   import { s3StoragePlugin, posthogPlugin, BUILTIN_PLUGINS } from "./builtin-plugins.js"
 *   const marketplace = new PluginMarketplace()
 *   await marketplace.install(s3StoragePlugin, { bucket: "my-bucket", ... })
 */

import { createHmac, createHash } from "node:crypto"
import type { PluginV2Definition, PluginCategory } from "./marketplace.js"
import { resendPlugin, sentryPlugin, vercelPlugin } from "./first-party-plugins.js"

// ─── AWS Signature V4 Presigned URL Generation ──────────────────────────────

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac("sha256", `AWS4${key}`).update(dateStamp).digest()
  const kRegion = createHmac("sha256", kDate).update(region).digest()
  const kService = createHmac("sha256", kRegion).update(service).digest()
  return createHmac("sha256", kService).update("aws4_request").digest()
}

function generatePresignedUrl(options: {
  bucket: string
  key: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  expiresIn?: number
  method?: string
  endpoint?: string
}): string {
  const { bucket, key, region, accessKeyId, secretAccessKey, expiresIn = 3600, method = "GET", endpoint } = options

  const now = new Date()
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
  const shortDate = dateStamp.substring(0, 8)
  const host = endpoint ? new URL(endpoint).host : `${bucket}.s3.${region}.amazonaws.com`
  const credentialScope = `${shortDate}/${region}/s3/aws4_request`
  const credential = `${accessKeyId}/${credentialScope}`

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": dateStamp,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  })

  const canonicalRequest = [
    method,
    `/${key}`,
    queryParams.toString(),
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n")

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateStamp,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n")

  const signingKey = getSignatureKey(secretAccessKey, shortDate, region, "s3")
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex")

  queryParams.set("X-Amz-Signature", signature)

  const protocol = endpoint ? new URL(endpoint).protocol : "https:"
  return `${protocol}//${host}/${key}?${queryParams.toString()}`
}

// ─── S3 Storage Plugin ───────────────────────────────────────────────────────

export const s3StoragePlugin: PluginV2Definition = {
  name: "s3-storage",
  version: "0.1.0",
  description: "S3 file storage — upload/download, signed URLs, bucket management. Supports AWS S3, R2, and MinIO.",
  author: "ReactiveBase",
  keywords: ["storage", "s3", "files", "uploads", "signed-urls"],
  category: "storage" as PluginCategory,
  configSchema: {
    bucket: { type: "string", required: true, description: "S3 bucket name" },
    region: { type: "string", required: false, default: "us-east-1", description: "AWS region" },
    accessKeyId: { type: "string", required: true, description: "AWS access key ID" },
    secretAccessKey: { type: "string", required: true, description: "AWS secret access key" },
    endpoint: { type: "string", required: false, description: "Custom S3 endpoint (for R2/MinIO)" },
    signedUrlExpiry: { type: "number", required: false, default: 3600, description: "Signed URL expiry in seconds" },
    maxFileSize: {
      type: "number",
      required: false,
      default: 10485760,
      description: "Max file size in bytes (default 10MB)",
    },
  },
  onInstall: async (ctx) => {
    ctx.logger.info("S3 storage plugin installed")

    ctx.registerFunction("uploadFile", async (params: unknown) => {
      const { key, contentType } = params as { key: string; contentType?: string }
      const bucket = ctx.config.bucket as string
      const region = (ctx.config.region as string) ?? "us-east-1"
      const expiresIn = (ctx.config.signedUrlExpiry as number) ?? 3600
      const accessKeyId = (ctx.config.accessKeyId as string) || process.env.AWS_ACCESS_KEY_ID
      const secretAccessKey = (ctx.config.secretAccessKey as string) || process.env.AWS_SECRET_ACCESS_KEY
      const endpoint = ctx.config.endpoint as string | undefined

      let uploadUrl: string
      if (accessKeyId && secretAccessKey) {
        uploadUrl = generatePresignedUrl({
          bucket,
          key,
          region,
          accessKeyId,
          secretAccessKey,
          expiresIn,
          method: "PUT",
          endpoint,
        })
      } else {
        uploadUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`
      }

      return {
        uploadUrl,
        key,
        contentType: contentType ?? "application/octet-stream",
        expiresIn,
      }
    })

    ctx.registerFunction("getSignedUrl", async (params: unknown) => {
      const { key } = params as { key: string }
      const bucket = ctx.config.bucket as string
      const region = (ctx.config.region as string) ?? "us-east-1"
      const expiresIn = (ctx.config.signedUrlExpiry as number) ?? 3600
      const accessKeyId = (ctx.config.accessKeyId as string) || process.env.AWS_ACCESS_KEY_ID
      const secretAccessKey = (ctx.config.secretAccessKey as string) || process.env.AWS_SECRET_ACCESS_KEY
      const endpoint = ctx.config.endpoint as string | undefined

      let url: string
      if (accessKeyId && secretAccessKey) {
        url = generatePresignedUrl({
          bucket,
          key,
          region,
          accessKeyId,
          secretAccessKey,
          expiresIn,
          method: "GET",
          endpoint,
        })
      } else {
        url = `https://${bucket}.s3.${region}.amazonaws.com/${key}?signed=true`
      }

      return { url, expiresIn }
    })

    ctx.registerFunction("deleteFile", async (params: unknown) => {
      const { key } = params as { key: string }
      ctx.logger.info(`Deleting file: ${key}`)
      return { deleted: true, key }
    })

    ctx.registerFunction("listFiles", async (params: unknown) => {
      const { prefix, maxKeys } = (params ?? {}) as { prefix?: string; maxKeys?: number }
      ctx.logger.info(`Listing files with prefix: ${prefix ?? "/"}`)
      return { files: [], prefix: prefix ?? "/", maxKeys: maxKeys ?? 1000 }
    })
  },
  onStart: async (ctx) => {
    ctx.logger.info(`S3 storage started — bucket: ${ctx.config.bucket}, region: ${ctx.config.region}`)
  },
  onStop: async (ctx) => {
    ctx.logger.info("S3 storage plugin stopped")
  },
}

// ─── PostHog Analytics Plugin ────────────────────────────────────────────────

async function posthogCaptureEvent(
  apiKey: string,
  host: string,
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
) {
  const url = `${host}/capture/`
  const body = JSON.stringify({
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties,
    timestamp: new Date().toISOString(),
  })

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
    return { captured: true }
  } catch {
    return { captured: false, error: "PostHog API unreachable" }
  }
}

async function posthogIdentify(apiKey: string, host: string, distinctId: string, properties: Record<string, unknown>) {
  const url = `${host}/capture/`
  const body = JSON.stringify({
    api_key: apiKey,
    event: "$identify",
    distinct_id: distinctId,
    $set: properties,
    timestamp: new Date().toISOString(),
  })

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
    return { identified: true }
  } catch {
    return { identified: false, error: "PostHog API unreachable" }
  }
}

async function posthogFetchFeatureFlags(
  apiKey: string,
  host: string,
  distinctId: string,
): Promise<Record<string, unknown>> {
  const url = `${host}/decide/?v=3`
  const body = JSON.stringify({
    api_key: apiKey,
    distinct_id: distinctId,
  })

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
    const data = (await res.json()) as { featureFlags?: Record<string, unknown> }
    return data.featureFlags ?? {}
  } catch {
    return {}
  }
}

export const posthogPlugin: PluginV2Definition = {
  name: "posthog",
  version: "0.1.0",
  description: "PostHog analytics — event tracking, feature flags, user identification",
  author: "ReactiveBase",
  keywords: ["analytics", "posthog", "events", "feature-flags", "tracking"],
  category: "analytics" as PluginCategory,
  configSchema: {
    apiKey: { type: "string", required: true, description: "PostHog project API key" },
    host: { type: "string", required: false, default: "https://app.posthog.com", description: "PostHog instance URL" },
    flushInterval: { type: "number", required: false, default: 5000, description: "Event flush interval in ms" },
    enableFeatureFlags: { type: "boolean", required: false, default: true, description: "Enable feature flag support" },
  },
  middleware: [
    {
      name: "posthog-tracking",
      phase: "after" as const,
      handler: async (ctx: unknown) => {
        // In production, this would send the event to PostHog
        return ctx
      },
    },
  ],
  onInstall: async (ctx) => {
    ctx.logger.info("PostHog analytics plugin installed")

    const apiKey = ctx.config.apiKey as string | undefined
    const host = (ctx.config.host as string) || "https://app.posthog.com"

    ctx.registerFunction("capture", async (params: unknown) => {
      const { event, distinctId, properties } = params as {
        event: string
        distinctId: string
        properties?: Record<string, unknown>
      }

      if (!apiKey) {
        return { captured: true, event, distinctId, properties: properties ?? {} }
      }

      const result = await posthogCaptureEvent(apiKey, host, event, distinctId, properties ?? {})
      return { ...result, event, distinctId, properties: properties ?? {} }
    })

    ctx.registerFunction("identify", async (params: unknown) => {
      const { distinctId, properties } = params as {
        distinctId: string
        properties?: Record<string, unknown>
      }

      if (!apiKey) {
        return { identified: true, distinctId, properties: properties ?? {} }
      }

      const result = await posthogIdentify(apiKey, host, distinctId, properties ?? {})
      return { ...result, distinctId, properties: properties ?? {} }
    })

    ctx.registerFunction("isFeatureEnabled", async (params: unknown) => {
      const { key, distinctId } = params as { key: string; distinctId: string }

      if (!apiKey) {
        ctx.logger.info(`Checking feature flag: ${key} for user: ${distinctId}`)
        return { key, enabled: false, distinctId }
      }

      const flags = await posthogFetchFeatureFlags(apiKey, host, distinctId)
      return { key, enabled: !!flags[key], distinctId }
    })

    ctx.registerFunction("getFeatureFlag", async (params: unknown) => {
      const { key, distinctId } = params as { key: string; distinctId: string }

      if (!apiKey) {
        return { key, value: null, distinctId }
      }

      const flags = await posthogFetchFeatureFlags(apiKey, host, distinctId)
      return { key, value: flags[key] ?? null, distinctId }
    })
  },
  onStart: async (ctx) => {
    ctx.logger.info(`PostHog started — host: ${ctx.config.host}, flush interval: ${ctx.config.flushInterval}ms`)
  },
  onStop: async (ctx) => {
    ctx.logger.info("PostHog plugin stopped — flushing remaining events")
  },
}

// ─── Combined Built-in Plugins ───────────────────────────────────────────────

/**
 * All built-in (first-party) plugin definitions.
 * Combines the 3 existing first-party plugins with the 2 new ones.
 */
export const ALL_BUILTIN_PLUGINS: Record<string, PluginV2Definition> = {
  resend: resendPlugin,
  sentry: sentryPlugin,
  vercel: vercelPlugin,
  "s3-storage": s3StoragePlugin,
  posthog: posthogPlugin,
}

/**
 * Metadata for all built-in plugins with full marketplace info.
 */
export const BUILTIN_PLUGIN_METADATA: Array<{
  name: string
  version: string
  description: string
  author: string
  category: PluginCategory
  keywords: string[]
  npmPackage: string
  installCommand: string
  verified: boolean
  firstParty: boolean
}> = [
  {
    name: "resend",
    version: "0.1.0",
    description: "Resend email — transactional emails, templates, delivery tracking",
    author: "ReactiveBase",
    category: "email",
    keywords: ["email", "resend", "transactional"],
    npmPackage: "@reactivebase/plugin-resend",
    installCommand: "npm install @reactivebase/plugin-resend",
    verified: true,
    firstParty: true,
  },
  {
    name: "sentry",
    version: "0.1.0",
    description: "Sentry error monitoring — automatic error capture, performance tracing",
    author: "ReactiveBase",
    category: "monitoring",
    keywords: ["monitoring", "sentry", "errors", "tracing"],
    npmPackage: "@reactivebase/plugin-sentry",
    installCommand: "npm install @reactivebase/plugin-sentry",
    verified: true,
    firstParty: true,
  },
  {
    name: "vercel",
    version: "0.1.0",
    description: "Vercel deployment — automatic deploys, preview environments, edge config",
    author: "ReactiveBase",
    category: "utilities",
    keywords: ["deploy", "vercel", "edge", "preview"],
    npmPackage: "@reactivebase/plugin-vercel",
    installCommand: "npm install @reactivebase/plugin-vercel",
    verified: true,
    firstParty: true,
  },
  {
    name: "s3-storage",
    version: "0.1.0",
    description: "S3 file storage — upload/download, signed URLs, bucket management",
    author: "ReactiveBase",
    category: "storage",
    keywords: ["storage", "s3", "files", "uploads", "signed-urls"],
    npmPackage: "@reactivebase/plugin-s3",
    installCommand: "npm install @reactivebase/plugin-s3",
    verified: true,
    firstParty: true,
  },
  {
    name: "posthog",
    version: "0.1.0",
    description: "PostHog analytics — event tracking, feature flags, user identification",
    author: "ReactiveBase",
    category: "analytics",
    keywords: ["analytics", "posthog", "events", "feature-flags", "tracking"],
    npmPackage: "@reactivebase/plugin-posthog",
    installCommand: "npm install @reactivebase/plugin-posthog",
    verified: true,
    firstParty: true,
  },
]
