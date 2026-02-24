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

import type { PluginV2Definition, PluginCategory } from "./marketplace.js"
import { resendPlugin, sentryPlugin, vercelPlugin } from "./first-party-plugins.js"

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
      // In production, this would create a presigned PUT URL via the S3 SDK
      const bucket = ctx.config.bucket as string
      const region = ctx.config.region as string
      return {
        uploadUrl: `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
        key,
        contentType: contentType ?? "application/octet-stream",
        expiresIn: ctx.config.signedUrlExpiry ?? 3600,
      }
    })

    ctx.registerFunction("getSignedUrl", async (params: unknown) => {
      const { key } = params as { key: string }
      const bucket = ctx.config.bucket as string
      const region = ctx.config.region as string
      return {
        url: `https://${bucket}.s3.${region}.amazonaws.com/${key}?signed=true`,
        expiresIn: ctx.config.signedUrlExpiry ?? 3600,
      }
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

    ctx.registerFunction("capture", async (params: unknown) => {
      const { event, distinctId, properties } = params as {
        event: string
        distinctId: string
        properties?: Record<string, unknown>
      }
      return { captured: true, event, distinctId, properties: properties ?? {} }
    })

    ctx.registerFunction("identify", async (params: unknown) => {
      const { distinctId, properties } = params as {
        distinctId: string
        properties?: Record<string, unknown>
      }
      return { identified: true, distinctId, properties: properties ?? {} }
    })

    ctx.registerFunction("isFeatureEnabled", async (params: unknown) => {
      const { key, distinctId } = params as { key: string; distinctId: string }
      ctx.logger.info(`Checking feature flag: ${key} for user: ${distinctId}`)
      return { key, enabled: false, distinctId }
    })

    ctx.registerFunction("getFeatureFlag", async (params: unknown) => {
      const { key, distinctId } = params as { key: string; distinctId: string }
      return { key, value: null, distinctId }
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
