export {
  createTenancyMiddleware,
  getTenantId,
  buildTenantFilter,
  generateTenantSchemaSQL,
  generateSetSchemaSQL,
  generateDropTenantSQL,
  getTenantFromState,
} from "./tenancy.js"
export type { TenancyConfig, TenantContext } from "./tenancy.js"

// SaaS Kit
export { SaasKit, DEFAULT_PLANS, generateSaasTablesSQL } from "./saas-kit.js"
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
} from "./saas-kit.js"

// Tenant Connection Routing
export {
  TenantConnectionRouter,
  buildSetTenantContextSQL,
  buildCreateRlsPolicySQL,
  buildEnableRlsSQL,
} from "./tenant-routing.js"
export type { TenantConnectionConfig, TenantConnection, TenantPoolStats } from "./tenant-routing.js"

// Stripe Billing
export { StripeBillingProvider } from "./stripe-billing.js"
export type { StripeConfig, StripeWebhookEvent, CheckoutSession, Invoice } from "./stripe-billing.js"

// Tenant Admin Dashboard
export { TenantAdminDashboard } from "./tenant-admin.js"
export type { TenantOverview, TenantDetail, RevenueSummary, TenantActivity } from "./tenant-admin.js"
