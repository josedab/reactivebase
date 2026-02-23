/**
 * Multi-Tenant SaaS Starter Kit.
 * Provides a complete tenant lifecycle manager with billing hooks,
 * tenant-aware subscriptions, onboarding flow, and admin overview.
 *
 * Usage:
 *   const saas = new SaasKit({ billingProvider: stripe })
 *   const tenant = await saas.onboardTenant({ name: "Acme", plan: "pro" })
 *   saas.enforcePlanLimits(tenantId, "subscriptions", currentCount)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SaasKitOptions {
  /** Billing provider integration */
  billingProvider?: SaasBillingProvider
  /** Available plans */
  plans?: SaasPlan[]
  /** Max tenants (default: unlimited) */
  maxTenants?: number
  /** Default plan for new tenants (default: "free") */
  defaultPlan?: string
}

export interface SaasPlan {
  id: string
  name: string
  priceCents: number
  interval: "monthly" | "yearly"
  limits: SaasPlanLimits
  features: string[]
}

export interface SaasPlanLimits {
  maxUsers: number
  maxSubscriptions: number
  maxStorageMb: number
  maxApiCallsPerDay: number
  maxEnvironments: number
}

export interface SaasTenant {
  id: string
  name: string
  slug: string
  plan: string
  status: "onboarding" | "active" | "suspended" | "cancelled"
  ownerEmail: string
  createdAt: number
  billingCustomerId: string | null
  usage: SaasTenantUsage
  metadata: Record<string, unknown>
}

export interface SaasTenantUsage {
  users: number
  subscriptions: number
  storageMb: number
  apiCallsToday: number
}

export interface SaasBillingProvider {
  createCustomer(email: string, name: string): Promise<string>
  createSubscription(customerId: string, planId: string): Promise<string>
  cancelSubscription(subscriptionId: string): Promise<void>
  getUsage(customerId: string): Promise<Record<string, number>>
}

export interface OnboardingConfig {
  name: string
  slug?: string
  ownerEmail: string
  plan?: string
  metadata?: Record<string, unknown>
}

export interface PlanLimitCheck {
  resource: string
  current: number
  limit: number
  exceeded: boolean
  usagePercent: number
}

export interface SaasAdminOverview {
  totalTenants: number
  activeTenants: number
  tenantsByPlan: Record<string, number>
  totalRevenueCents: number
  totalUsers: number
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateSaasTablesSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'onboarding',
  owner_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  billing_customer_id TEXT,
  metadata JSONB DEFAULT '{}',
  usage_users INTEGER NOT NULL DEFAULT 0,
  usage_subscriptions INTEGER NOT NULL DEFAULT 0,
  usage_storage_mb INTEGER NOT NULL DEFAULT 0,
  usage_api_calls_today INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON _reactivebase_tenants (slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON _reactivebase_tenants (status);`
}

// ─── Default Plans ───────────────────────────────────────────────────────────

export const DEFAULT_PLANS: SaasPlan[] = [
  {
    id: "free",
    name: "Free",
    priceCents: 0,
    interval: "monthly",
    limits: { maxUsers: 3, maxSubscriptions: 100, maxStorageMb: 500, maxApiCallsPerDay: 1000, maxEnvironments: 1 },
    features: ["Basic queries", "Community support"],
  },
  {
    id: "starter",
    name: "Starter",
    priceCents: 2900,
    interval: "monthly",
    limits: { maxUsers: 10, maxSubscriptions: 1000, maxStorageMb: 5000, maxApiCallsPerDay: 10000, maxEnvironments: 3 },
    features: ["Reactive queries", "Email support", "Custom domains"],
  },
  {
    id: "pro",
    name: "Pro",
    priceCents: 9900,
    interval: "monthly",
    limits: {
      maxUsers: 50,
      maxSubscriptions: 10000,
      maxStorageMb: 50000,
      maxApiCallsPerDay: 100000,
      maxEnvironments: 10,
    },
    features: ["All features", "Priority support", "SSO", "Audit log"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceCents: 49900,
    interval: "monthly",
    limits: {
      maxUsers: Infinity,
      maxSubscriptions: Infinity,
      maxStorageMb: Infinity,
      maxApiCallsPerDay: Infinity,
      maxEnvironments: Infinity,
    },
    features: ["Unlimited", "Dedicated support", "SLA", "Custom contracts"],
  },
]

// ─── SaaS Kit ────────────────────────────────────────────────────────────────

export class SaasKit {
  private options: Required<Omit<SaasKitOptions, "billingProvider">> & Pick<SaasKitOptions, "billingProvider">
  private tenants = new Map<string, SaasTenant>()
  private idCounter = 0

  constructor(options: SaasKitOptions = {}) {
    this.options = {
      plans: DEFAULT_PLANS,
      maxTenants: Infinity,
      defaultPlan: "free",
      ...options,
    }
  }

  private generateId(): string {
    return `tenant_${++this.idCounter}_${Date.now().toString(36)}`
  }

  // ─── Tenant Lifecycle ──────────────────────────────────────────────────

  async onboardTenant(config: OnboardingConfig): Promise<SaasTenant> {
    if (this.tenants.size >= this.options.maxTenants) {
      throw new Error("Maximum tenant limit reached")
    }

    const slug = config.slug ?? config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    if (Array.from(this.tenants.values()).some((t) => t.slug === slug)) {
      throw new Error(`Tenant slug "${slug}" already exists`)
    }

    let billingCustomerId: string | null = null
    if (this.options.billingProvider) {
      billingCustomerId = await this.options.billingProvider.createCustomer(config.ownerEmail, config.name)
    }

    const tenant: SaasTenant = {
      id: this.generateId(),
      name: config.name,
      slug,
      plan: config.plan ?? this.options.defaultPlan,
      status: "active",
      ownerEmail: config.ownerEmail,
      createdAt: Date.now(),
      billingCustomerId,
      usage: { users: 1, subscriptions: 0, storageMb: 0, apiCallsToday: 0 },
      metadata: config.metadata ?? {},
    }

    this.tenants.set(tenant.id, tenant)
    return tenant
  }

  getTenant(tenantId: string): SaasTenant | undefined {
    return this.tenants.get(tenantId)
  }

  listTenants(status?: SaasTenant["status"]): SaasTenant[] {
    const all = Array.from(this.tenants.values())
    return status ? all.filter((t) => t.status === status) : all
  }

  async suspendTenant(tenantId: string): Promise<void> {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)
    tenant.status = "suspended"
  }

  async reactivateTenant(tenantId: string): Promise<void> {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)
    tenant.status = "active"
  }

  async changePlan(tenantId: string, newPlan: string): Promise<void> {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)
    if (!this.options.plans.find((p) => p.id === newPlan)) throw new Error(`Plan "${newPlan}" not found`)
    tenant.plan = newPlan
  }

  // ─── Plan Enforcement ──────────────────────────────────────────────────

  checkPlanLimit(tenantId: string, resource: keyof SaasPlanLimits, current: number): PlanLimitCheck {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)

    const plan = this.options.plans.find((p) => p.id === tenant.plan)
    if (!plan) return { resource, current, limit: Infinity, exceeded: false, usagePercent: 0 }

    const limit = plan.limits[resource]
    return {
      resource,
      current,
      limit,
      exceeded: current >= limit,
      usagePercent: limit === Infinity ? 0 : Math.round((current / limit) * 100),
    }
  }

  updateUsage(tenantId: string, usage: Partial<SaasTenantUsage>): void {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)
    Object.assign(tenant.usage, usage)
  }

  // ─── Admin Overview ────────────────────────────────────────────────────

  getAdminOverview(): SaasAdminOverview {
    const tenants = Array.from(this.tenants.values())
    const byPlan: Record<string, number> = {}
    let totalRevenue = 0
    let totalUsers = 0

    for (const tenant of tenants) {
      byPlan[tenant.plan] = (byPlan[tenant.plan] ?? 0) + 1
      const plan = this.options.plans.find((p) => p.id === tenant.plan)
      if (plan && tenant.status === "active") totalRevenue += plan.priceCents
      totalUsers += tenant.usage.users
    }

    return {
      totalTenants: tenants.length,
      activeTenants: tenants.filter((t) => t.status === "active").length,
      tenantsByPlan: byPlan,
      totalRevenueCents: totalRevenue,
      totalUsers,
    }
  }

  getPlans(): SaasPlan[] {
    return [...this.options.plans]
  }
}
