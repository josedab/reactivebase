export { definePlugin, PluginRegistry, clerkPlugin, stripePlugin } from "./plugins.js"
export type { PluginDefinition, PluginContext, PluginManifest } from "./plugins.js"

export { PluginRegistryClient, BUILTIN_PLUGINS } from "./registry.js"
export type { RegistryEntry } from "./registry.js"

// Plugin Marketplace v2
export {
  PluginMarketplace,
  PluginMarketplaceError,
  validatePluginConfig,
  MARKETPLACE_CATALOG,
} from "./marketplace.js"
export type {
  PluginV2Definition,
  PluginV2Instance,
  PluginV2Context,
  PluginCategory,
  ConfigField,
  PluginMiddleware,
  MarketplaceEntry,
  MarketplaceSearchOptions,
} from "./marketplace.js"

// First-Party Plugins & Quality Scoring
export {
  computePluginQualityScore,
  checkPluginCompatibility,
  generatePluginTemplate,
  resendPlugin,
  sentryPlugin,
  vercelPlugin,
  FIRST_PARTY_PLUGINS,
} from "./first-party-plugins.js"
export type {
  PluginQualityInfo,
  PluginQualityScore,
  PluginCompatibility,
  PluginTemplate,
} from "./first-party-plugins.js"

// Plugin Developer Portal
export { PluginPortal } from "./plugin-portal.js"
export type { PortalPlugin, PluginCompatibilityStatus, CompatibilityMatrix, PluginScaffold, PortalStats } from "./plugin-portal.js"
