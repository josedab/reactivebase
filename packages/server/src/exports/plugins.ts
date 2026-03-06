// Plugins
export {
  definePlugin,
  PluginRegistry,
  clerkPlugin,
  stripePlugin,
  PluginRegistryClient,
  BUILTIN_PLUGINS,
} from "../plugins/index.js"
export {
  PluginMarketplace,
  PluginMarketplaceError,
  validatePluginConfig,
  MARKETPLACE_CATALOG,
} from "../plugins/index.js"
export {
  computePluginQualityScore,
  checkPluginCompatibility,
  generatePluginTemplate,
  resendPlugin,
  sentryPlugin,
  vercelPlugin,
  FIRST_PARTY_PLUGINS,
} from "../plugins/index.js"
export { PluginPortal } from "../plugins/index.js"
export { PluginSDK, PluginTestHarness, validateWithJSONSchema } from "../plugins/index.js"
export { s3StoragePlugin, posthogPlugin, ALL_BUILTIN_PLUGINS, BUILTIN_PLUGIN_METADATA } from "../plugins/index.js"
export { PluginCLI } from "../plugins/index.js"
export type { PluginDefinition, PluginContext, PluginManifest, RegistryEntry } from "../plugins/index.js"
export type {
  PluginV2Definition,
  PluginV2Instance,
  PluginV2Context,
  PluginCategory,
  ConfigField,
  MarketplaceEntry,
  MarketplaceSearchOptions,
} from "../plugins/index.js"
export type { PluginQualityInfo, PluginQualityScore, PluginCompatibility, PluginTemplate } from "../plugins/index.js"
export type {
  PortalPlugin,
  PluginCompatibilityStatus,
  CompatibilityMatrix,
  PluginScaffold,
  PortalStats,
} from "../plugins/index.js"
export type { PluginV2Config, PluginHook, PluginCLIConfig, CLIResult } from "../plugins/index.js"

// Plugin Registry Backend & Installer
export {
  PluginRegistryBackend,
  PluginInstaller,
  PluginWebUI,
  PluginRegistryError,
  buildCreatePluginRegistrySQL,
  buildInsertPluginSQL,
  buildSearchPluginsSQL,
} from "../plugins/index.js"
export type {
  RegistrySearchOptions,
  NpmPackageInfo,
  PluginVersion,
  PluginCompatibilityResult,
  InstallerOptions,
  PluginInstallResult,
  WebUIOptions,
} from "../plugins/index.js"

// Plugin Marketplace v3
export {
  PluginContract,
  definePluginV3,
  PluginSecurityScanner,
  PluginStarterTemplates,
  MarketplaceSearchEngine,
} from "../plugins/index.js"
export type {
  PluginV3Config,
  PluginV3Context,
  PluginV3Instance,
  PluginV3TestContext,
  PluginLifecycleHooks,
  PluginHealthStatus,
  SecuritySeverity,
  SecurityIssue,
  SecurityScanResult,
  TemplateType,
  PluginTemplateV3,
  SearchFilters,
  SearchResult as PluginSearchResult,
  ScoredEntry,
  PluginRecommendation,
} from "../plugins/index.js"
