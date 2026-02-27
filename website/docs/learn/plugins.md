---
sidebar_position: 8
---

# Plugins

ReactiveBase has a full plugin system that lets you extend the server with reusable functionality — authentication providers, storage backends, billing integrations, and more.

## Defining a Plugin

Use `definePlugin` to create a plugin:

```typescript
import { definePlugin } from "@reactivebase/server"

const myPlugin = definePlugin({
  name: "my-plugin",
  version: "1.0.0",

  // Add middleware that runs on every request
  middleware: [
    {
      name: "my-logger",
      before: async (ctx) => {
        console.log(`[${ctx.method}] ${ctx.path}`)
      },
    },
  ],

  // Add custom functions
  functions: {
    "myPlugin.status": {
      type: "query",
      handler: async (ctx) => ({ active: true }),
    },
  },

  // Lifecycle hooks
  setup: async (ctx) => {
    ctx.logger.info("Plugin installed")
  },
  onStart: async (ctx) => {
    ctx.logger.info("Plugin started")
  },
  onStop: async (ctx) => {
    ctx.logger.info("Plugin stopped")
  },
})
```

## Plugin Definition Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique plugin identifier |
| `version` | `string` | Semver version |
| `middleware` | `Middleware[]` | Before/after request hooks |
| `authProviders` | `AuthProvider[]` | Custom auth strategies |
| `functions` | `Record<string, Function>` | Custom query/mutation/action handlers |
| `webhooks` | `WebhookHandler[]` | Inbound webhook handlers |
| `storageBackend` | `StorageBackend` | Custom file storage backend |
| `setup` | `(ctx) => Promise<void>` | Called once on install |
| `onStart` | `(ctx) => Promise<void>` | Called on server start |
| `onStop` | `(ctx) => Promise<void>` | Called on server stop |

## Built-in Plugins

ReactiveBase ships with several first-party plugins:

```typescript
import { clerkPlugin, stripePlugin, s3StoragePlugin, posthogPlugin } from "@reactivebase/server"

export default defineConfig({
  plugins: [
    clerkPlugin({ secretKey: process.env.CLERK_SECRET_KEY }),
    stripePlugin({ apiKey: process.env.STRIPE_API_KEY }),
    s3StoragePlugin({ bucket: "my-bucket", region: "us-east-1" }),
    posthogPlugin({ apiKey: process.env.POSTHOG_API_KEY }),
  ],
})
```

## Plugin Registry

The `PluginRegistry` manages installed plugins and their lifecycle:

```typescript
import { PluginRegistry } from "@reactivebase/server"

const registry = new PluginRegistry()

// Register plugins
registry.register(myPlugin)

// Start all plugins
await registry.startAll()

// Stop all plugins (on shutdown)
await registry.stopAll()
```

## Plugin Marketplace

Browse and install community plugins from the marketplace:

```typescript
import { PluginMarketplace, MARKETPLACE_CATALOG } from "@reactivebase/server"

// Browse available plugins
const marketplace = new PluginMarketplace()
const plugins = marketplace.search("auth")

// Check compatibility before installing
import { checkPluginCompatibility } from "@reactivebase/server"
const result = checkPluginCompatibility(plugin, { serverVersion: "0.1.0" })
```

## Scaffolding a New Plugin

Use the CLI or the `generatePluginTemplate` function:

```typescript
import { generatePluginTemplate } from "@reactivebase/server"

const template = generatePluginTemplate("my-analytics", "analytics")
// Returns { indexTs, packageJson, readmeMd, testTs }
```

## Plugin SDK v2

For more advanced plugins, use the v2 SDK which supports config schemas and validation:

```typescript
import type { PluginV2Definition } from "@reactivebase/server"

const analyticsPlugin: PluginV2Definition = {
  name: "analytics",
  version: "0.1.0",
  description: "Track user events",
  category: "analytics",
  configSchema: {
    apiKey: { type: "string", required: true, description: "Analytics API key" },
    trackingId: { type: "string", required: false, description: "Tracking ID" },
  },
  onInstall: async (ctx) => { /* ... */ },
  onStart: async (ctx) => { /* ... */ },
}
```

## Testing Plugins

Use `PluginTestHarness` to test plugins in isolation:

```typescript
import { PluginTestHarness } from "@reactivebase/server"

const harness = new PluginTestHarness(myPlugin)
await harness.setup()

// Test plugin functions
const result = await harness.callFunction("myPlugin.status", {})
expect(result.active).toBe(true)

await harness.teardown()
```

## Next Steps

- [Schema Deep Dive](./schema-deep-dive.md) — Define tables and validators
- [Workflows](./workflows.md) — Orchestrate multi-step background processes
- [Observability](./observability.md) — Monitor your plugins with metrics and tracing
