# ADR-002: Plugin Protocol Design

## Status
Accepted

## Context
ReactiveBase needs an extensibility mechanism that allows community contributions (auth providers, storage backends, webhook integrations) without modifying the core framework.

## Decision
Implement a `definePlugin()` API with a `PluginRegistry` that accepts plugins providing middleware, auth providers, functions, webhooks, and storage backends. Plugins are installed via `server.use(plugin)` or CLI `reactivebase add <plugin>`.

## Rationale
- **Middleware-only** approach (like Express) is too limited for auth providers and webhooks
- **Module system** (like NestJS) is too heavy for a framework targeting simplicity
- **Plugin protocol** provides a single registration point where a plugin can contribute to multiple subsystems
- The `PluginDefinition` interface is intentionally minimal: name + optional arrays of middleware/authProviders/functions/webhooks + lifecycle hooks

## Implementation
```typescript
interface PluginDefinition {
  name: string
  middleware?: Middleware[]
  authProviders?: AuthProvider[]
  functions?: Record<string, RegisteredFunction>
  webhooks?: WebhookDefinition[]
  storageBackend?: StorageBackend
  setup?: (context: PluginContext) => Promise<void>
  onStart?: () => Promise<void>
  onStop?: () => Promise<void>
}
```

## Consequences
- Plugins can contribute to multiple subsystems in one package
- `PluginContext` provides a safe API surface — plugins cannot access server internals
- Plugin interface is versioned: breaking changes require a major version bump
- Built-in plugin registry provides discovery without a centralized service
