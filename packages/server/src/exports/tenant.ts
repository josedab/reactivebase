// Multi-Tenancy
export {
  createTenancyMiddleware,
  getTenantId,
  buildTenantFilter,
  generateTenantSchemaSQL,
  generateSetSchemaSQL,
  generateDropTenantSQL,
} from "../tenancy/index.js"
export { SaasKit, DEFAULT_PLANS, generateSaasTablesSQL } from "../tenancy/index.js"
export {
  TenantConnectionRouter,
  buildSetTenantContextSQL,
  buildCreateRlsPolicySQL,
  buildEnableRlsSQL,
} from "../tenancy/index.js"
export { StripeBillingProvider } from "../tenancy/index.js"
export { TenantAdminDashboard } from "../tenancy/index.js"
export type { TenancyConfig, TenantContext } from "../tenancy/index.js"
export type {
  SaasKitOptions,
  SaasPlan,
  SaasPlanLimits,
  SaasTenant,
  SaasTenantUsage,
  SaasBillingProvider,
  OnboardingConfig,
  PlanLimitCheck,
  SaasAdminOverview,
} from "../tenancy/index.js"
export type { TenantConnectionConfig, TenantConnection, TenantPoolStats } from "../tenancy/index.js"
export type { StripeConfig, StripeWebhookEvent, CheckoutSession, Invoice } from "../tenancy/index.js"
export type { TenantOverview, TenantDetail, RevenueSummary, TenantActivity } from "../tenancy/index.js"

// SaaS Template & Analytics
export {
  SaasTemplateScaffold,
  StripeSubscriptionManager,
  TenantAnalytics,
  buildTenantsTableSQL,
  buildUsersTableSQL,
  buildTeamsTableSQL,
  buildRolesTableSQL,
  buildInvitationsTableSQL,
  buildFeatureFlagsTableSQL,
  buildUsageMetricsTableSQL,
} from "../tenancy/index.js"
export type {
  SaasTemplateOptions,
  OnboardingStep,
  TeamRole,
  FeatureFlag,
  FeatureFlagOverride,
  SubscriptionStatus,
  UsageMetric,
  RevenueMetrics,
  TenantHealthScore,
  SaasTemplateConfig,
} from "../tenancy/index.js"
