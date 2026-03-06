/**
 * SaaS Template Scaffold, Stripe Subscription Manager, and Tenant Analytics.
 * Provides template generation, subscription lifecycle, and per-tenant analytics
 * for the ReactiveBase multi-tenant SaaS kit.
 *
 * Usage:
 *   const scaffold = new SaasTemplateScaffold()
 *   const sql = scaffold.generateSchema()
 *   const analytics = new TenantAnalytics()
 *   const metrics = analytics.getRevenueMetrics("30d")
 */

import type { SaasBillingProvider as _SaasBillingProvider, SaasPlan } from "./saas-kit.js"
import type { StripeConfig, StripeWebhookEvent, CheckoutSession, Invoice } from "./stripe-billing.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SaasTemplateOptions {
  /** Project name */
  name: string
  /** Include billing integration (default: true) */
  billing?: boolean
  /** Include team management (default: true) */
  teams?: boolean
  /** Include feature flags (default: true) */
  featureFlags?: boolean
  /** Include admin dashboard (default: true) */
  adminDashboard?: boolean
  /** Default plan for new tenants */
  defaultPlan?: string
}

export interface OnboardingStep {
  id: string
  title: string
  description: string
  type: "form" | "action" | "redirect"
  /** Fields for form steps */
  fields?: Array<{ name: string; type: string; required: boolean; label: string }>
  /** Action handler name for action steps */
  action?: string
  /** URL for redirect steps */
  redirectUrl?: string
  /** Whether this step can be skipped */
  optional?: boolean
}

export interface TeamRole {
  id: string
  name: string
  description: string
  permissions: string[]
  isDefault?: boolean
}

export interface FeatureFlag {
  id: string
  name: string
  description: string
  defaultValue: boolean
  /** Plans that have this flag enabled by default */
  enabledForPlans?: string[]
}

export interface FeatureFlagOverride {
  flagId: string
  tenantId: string
  value: boolean
  reason?: string
  createdAt: number
}

export interface SubscriptionStatus {
  tenantId: string
  planId: string
  status: "active" | "past_due" | "cancelled" | "trialing" | "paused"
  currentPeriodStart: number
  currentPeriodEnd: number
  cancelAtPeriodEnd: boolean
  stripeSubscriptionId: string | null
  stripeCustomerId: string | null
}

export interface UsageMetric {
  tenantId: string
  metric: string
  value: number
  period: string
  recordedAt: number
}

export interface RevenueMetrics {
  mrr: number
  arr: number
  churnRate: number
  ltv: number
  totalCustomers: number
  payingCustomers: number
  averageRevenuePerUser: number
  revenueByPlan: Record<string, number>
  growthRate: number
}

export interface TenantHealthScore {
  tenantId: string
  score: number
  riskLevel: "healthy" | "at-risk" | "critical"
  indicators: {
    apiUsageTrend: "increasing" | "stable" | "declining"
    lastActiveAt: number
    daysSinceLastActivity: number
    planUtilization: number
    teamSize: number
    featureAdoption: number
  }
}

export interface SaasTemplateConfig {
  options: SaasTemplateOptions
  plans: SaasPlan[]
  roles: TeamRole[]
  flags: FeatureFlag[]
  onboardingSteps: OnboardingStep[]
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function buildTenantsTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _rb_tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'onboarding',
  owner_email TEXT NOT NULL,
  billing_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_rb_tenants_slug ON _rb_tenants (slug);
CREATE INDEX IF NOT EXISTS idx_rb_tenants_status ON _rb_tenants (status);
CREATE INDEX IF NOT EXISTS idx_rb_tenants_plan ON _rb_tenants (plan);`
}

export function buildUsersTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _rb_users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES _rb_tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  invited_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_rb_users_tenant ON _rb_users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rb_users_email ON _rb_users (email);`
}

export function buildTeamsTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _rb_teams (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES _rb_tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rb_teams_tenant ON _rb_teams (tenant_id);

CREATE TABLE IF NOT EXISTS _rb_team_members (
  team_id TEXT NOT NULL REFERENCES _rb_teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES _rb_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);`
}

export function buildRolesTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _rb_roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES _rb_tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_rb_roles_tenant ON _rb_roles (tenant_id);`
}

export function buildInvitationsTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _rb_invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES _rb_tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT NOT NULL REFERENCES _rb_users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rb_invitations_tenant ON _rb_invitations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rb_invitations_token ON _rb_invitations (token);
CREATE INDEX IF NOT EXISTS idx_rb_invitations_email ON _rb_invitations (email);`
}

export function buildFeatureFlagsTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _rb_feature_flags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  default_value BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_for_plans JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _rb_feature_flag_overrides (
  flag_id TEXT NOT NULL REFERENCES _rb_feature_flags(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES _rb_tenants(id) ON DELETE CASCADE,
  value BOOLEAN NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (flag_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_rb_ff_overrides_tenant ON _rb_feature_flag_overrides (tenant_id);`
}

export function buildUsageMetricsTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _rb_usage_metrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES _rb_tenants(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  value NUMERIC NOT NULL DEFAULT 0,
  period TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rb_usage_tenant ON _rb_usage_metrics (tenant_id, period);
CREATE INDEX IF NOT EXISTS idx_rb_usage_metric ON _rb_usage_metrics (metric, period);`
}

// ─── SaaS Template Scaffold ─────────────────────────────────────────────────

export class SaasTemplateScaffold {
  /**
   * Generate complete SQL schema for tenant/user/team/role/invitation/feature_flag tables.
   */
  generateSchema(): string {
    return [
      "-- ReactiveBase SaaS Kit Schema",
      "-- Generated by SaasTemplateScaffold",
      "",
      "-- Tenants",
      buildTenantsTableSQL(),
      "",
      "-- Users",
      buildUsersTableSQL(),
      "",
      "-- Teams",
      buildTeamsTableSQL(),
      "",
      "-- Roles",
      buildRolesTableSQL(),
      "",
      "-- Invitations",
      buildInvitationsTableSQL(),
      "",
      "-- Feature Flags",
      buildFeatureFlagsTableSQL(),
      "",
      "-- Usage Metrics",
      buildUsageMetricsTableSQL(),
    ].join("\n")
  }

  /**
   * Generate onboarding flow configuration.
   */
  generateOnboardingFlow(options?: {
    includeTeamInvite?: boolean
    includeBillingSetup?: boolean
    customSteps?: OnboardingStep[]
  }): OnboardingStep[] {
    const steps: OnboardingStep[] = [
      {
        id: "signup",
        title: "Create Your Account",
        description: "Sign up with your email and set a password.",
        type: "form",
        fields: [
          { name: "email", type: "email", required: true, label: "Email" },
          { name: "name", type: "text", required: true, label: "Full Name" },
          { name: "password", type: "password", required: true, label: "Password" },
        ],
      },
      {
        id: "create-workspace",
        title: "Create Your Workspace",
        description: "Set up your organization workspace.",
        type: "form",
        fields: [
          { name: "orgName", type: "text", required: true, label: "Organization Name" },
          { name: "slug", type: "text", required: false, label: "Workspace URL" },
        ],
      },
    ]

    if (options?.includeTeamInvite !== false) {
      steps.push({
        id: "invite-team",
        title: "Invite Your Team",
        description: "Add team members to your workspace.",
        type: "form",
        optional: true,
        fields: [
          { name: "emails", type: "textarea", required: false, label: "Email addresses (one per line)" },
          { name: "role", type: "select", required: false, label: "Default Role" },
        ],
      })
    }

    if (options?.includeBillingSetup !== false) {
      steps.push({
        id: "billing-setup",
        title: "Choose Your Plan",
        description: "Select a plan that fits your needs. You can change this later.",
        type: "action",
        optional: true,
        action: "selectPlan",
      })
    }

    if (options?.customSteps) {
      steps.push(...options.customSteps)
    }

    return steps
  }

  /**
   * Generate team management operations configuration.
   */
  generateTeamManagement(): {
    roles: TeamRole[]
    operations: Record<string, { description: string; requiredPermission: string }>
    invitationConfig: { expiresInHours: number; maxPendingPerTenant: number }
  } {
    const roles: TeamRole[] = [
      {
        id: "owner",
        name: "Owner",
        description: "Full access to all resources and settings.",
        permissions: [
          "tenant.manage",
          "billing.manage",
          "team.manage",
          "team.invite",
          "project.create",
          "project.delete",
          "project.edit",
          "project.view",
          "settings.manage",
        ],
      },
      {
        id: "admin",
        name: "Admin",
        description: "Manage team members and projects.",
        permissions: [
          "team.manage",
          "team.invite",
          "project.create",
          "project.delete",
          "project.edit",
          "project.view",
          "settings.view",
        ],
      },
      {
        id: "member",
        name: "Member",
        description: "Create and edit projects.",
        permissions: ["project.create", "project.edit", "project.view"],
        isDefault: true,
      },
      {
        id: "viewer",
        name: "Viewer",
        description: "View-only access to projects.",
        permissions: ["project.view"],
      },
    ]

    const operations = {
      "team.create": { description: "Create a new team", requiredPermission: "team.manage" },
      "team.update": { description: "Update team details", requiredPermission: "team.manage" },
      "team.delete": { description: "Delete a team", requiredPermission: "team.manage" },
      "team.addMember": { description: "Add a member to a team", requiredPermission: "team.manage" },
      "team.removeMember": { description: "Remove a member from a team", requiredPermission: "team.manage" },
      "team.invite": { description: "Invite a user to the tenant", requiredPermission: "team.invite" },
      "role.assign": { description: "Assign a role to a user", requiredPermission: "team.manage" },
    }

    return {
      roles,
      operations,
      invitationConfig: { expiresInHours: 72, maxPendingPerTenant: 50 },
    }
  }

  /**
   * Generate per-tenant feature flag system configuration.
   */
  generateFeatureFlags(flags: FeatureFlag[]): {
    flags: FeatureFlag[]
    evaluator: string
    sql: string
  } {
    const evaluator = `
// Feature flag evaluator — checks overrides then plan defaults then global default
function evaluateFlag(
  flagId: string,
  tenantId: string,
  tenantPlan: string,
  flags: Map<string, { defaultValue: boolean; enabledForPlans: string[] }>,
  overrides: Map<string, boolean>,
): boolean {
  const overrideKey = flagId + ":" + tenantId
  if (overrides.has(overrideKey)) return overrides.get(overrideKey)!
  const flag = flags.get(flagId)
  if (!flag) return false
  if (flag.enabledForPlans.includes(tenantPlan)) return true
  return flag.defaultValue
}`

    const insertStatements = flags
      .map(
        (f) =>
          `INSERT INTO _rb_feature_flags (id, name, description, default_value, enabled_for_plans) VALUES ('${f.id}', '${f.name}', '${f.description}', ${f.defaultValue}, '${JSON.stringify(f.enabledForPlans ?? [])}') ON CONFLICT (name) DO NOTHING;`,
      )
      .join("\n")

    return { flags, evaluator, sql: insertStatements }
  }

  /**
   * Generate self-contained HTML admin dashboard for tenant management.
   */
  generateAdminDashboard(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactiveBase - SaaS Admin Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #f8fafc; }
    h2 { font-size: 18px; margin-bottom: 16px; color: #cbd5e1; }
    .subtitle { font-size: 14px; color: #64748b; margin-bottom: 24px; }
    .tabs { display: flex; gap: 4px; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 4px; }
    .tab { padding: 8px 16px; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 13px; color: #94a3b8; background: transparent; border: none; }
    .tab.active { background: #1e293b; color: #f8fafc; }
    .tab:hover { color: #f8fafc; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #1e293b; border-radius: 8px; padding: 20px; border: 1px solid #334155; }
    .card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 6px; }
    .card .value { font-size: 28px; font-weight: 700; color: #f8fafc; }
    .card .trend { font-size: 12px; margin-top: 4px; }
    .trend.up { color: #4ade80; }
    .trend.down { color: #f87171; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; border: 1px solid #334155; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #334155; }
    th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; background: #0f172a; }
    td { font-size: 13px; color: #cbd5e1; }
    .badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge-active { background: #064e3b; color: #6ee7b7; }
    .badge-suspended { background: #78350f; color: #fcd34d; }
    .badge-cancelled { background: #7f1d1d; color: #fca5a5; }
    .badge-onboarding { background: #1e3a5f; color: #93c5fd; }
    .badge-healthy { background: #064e3b; color: #6ee7b7; }
    .badge-at-risk { background: #78350f; color: #fcd34d; }
    .badge-critical { background: #7f1d1d; color: #fca5a5; }
    .section { margin-bottom: 32px; }
    .panel { display: none; }
    .panel.active { display: block; }
    .search-bar { width: 100%; padding: 10px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 13px; margin-bottom: 16px; }
    .search-bar::placeholder { color: #475569; }
    .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #334155; }
    .toggle-label { font-size: 13px; color: #cbd5e1; }
    .toggle-desc { font-size: 11px; color: #64748b; }
    .toggle { width: 40px; height: 22px; background: #334155; border-radius: 11px; cursor: pointer; position: relative; border: none; }
    .toggle.on { background: #3b82f6; }
    .toggle::after { content: ''; width: 16px; height: 16px; background: #f8fafc; border-radius: 50%; position: absolute; top: 3px; left: 3px; transition: 0.2s; }
    .toggle.on::after { left: 21px; }
    .btn { padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; border: none; font-weight: 500; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-danger { background: #ef4444; color: #fff; }
    .btn-ghost { background: transparent; border: 1px solid #334155; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 SaaS Admin Dashboard</h1>
    <p class="subtitle">ReactiveBase Multi-Tenant Management</p>

    <div class="tabs">
      <button class="tab active" onclick="showPanel('overview')">Overview</button>
      <button class="tab" onclick="showPanel('tenants')">Tenants</button>
      <button class="tab" onclick="showPanel('revenue')">Revenue</button>
      <button class="tab" onclick="showPanel('flags')">Feature Flags</button>
      <button class="tab" onclick="showPanel('users')">Users & Teams</button>
    </div>

    <!-- Overview Panel -->
    <div id="panel-overview" class="panel active">
      <div class="grid">
        <div class="card"><div class="label">Total Tenants</div><div class="value" id="stat-tenants">—</div></div>
        <div class="card"><div class="label">Active</div><div class="value" id="stat-active">—</div></div>
        <div class="card"><div class="label">MRR</div><div class="value" id="stat-mrr">—</div><div class="trend up" id="stat-mrr-trend"></div></div>
        <div class="card"><div class="label">ARR</div><div class="value" id="stat-arr">—</div></div>
        <div class="card"><div class="label">Churn Rate</div><div class="value" id="stat-churn">—</div></div>
        <div class="card"><div class="label">Growth Rate</div><div class="value" id="stat-growth">—</div><div class="trend up" id="stat-growth-trend"></div></div>
      </div>
      <div class="section">
        <h2>Plan Distribution</h2>
        <div id="plan-dist"></div>
      </div>
    </div>

    <!-- Tenants Panel -->
    <div id="panel-tenants" class="panel">
      <input class="search-bar" placeholder="Search tenants by name, email, or plan..." id="tenant-search" oninput="filterTenants()" />
      <table>
        <thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Plan</th><th>Email</th><th>Users</th><th>Health</th><th>Created</th></tr></thead>
        <tbody id="tenants-tbody"><tr><td colspan="8" style="text-align:center;color:#475569;">Loading tenants...</td></tr></tbody>
      </table>
    </div>

    <!-- Revenue Panel -->
    <div id="panel-revenue" class="panel">
      <div class="grid">
        <div class="card"><div class="label">Monthly Recurring Revenue</div><div class="value" id="rev-mrr">—</div></div>
        <div class="card"><div class="label">Annual Recurring Revenue</div><div class="value" id="rev-arr">—</div></div>
        <div class="card"><div class="label">Avg Revenue / Tenant</div><div class="value" id="rev-arpu">—</div></div>
        <div class="card"><div class="label">Paying Customers</div><div class="value" id="rev-paying">—</div></div>
        <div class="card"><div class="label">Lifetime Value</div><div class="value" id="rev-ltv">—</div></div>
      </div>
      <div class="section">
        <h2>Revenue by Plan</h2>
        <div id="rev-by-plan"></div>
      </div>
    </div>

    <!-- Feature Flags Panel -->
    <div id="panel-flags" class="panel">
      <h2>Feature Flags</h2>
      <div id="flags-list">
        <div class="toggle-row">
          <div><div class="toggle-label">advanced_analytics</div><div class="toggle-desc">Enable advanced analytics dashboard for tenants</div></div>
          <button class="toggle on"></button>
        </div>
        <div class="toggle-row">
          <div><div class="toggle-label">custom_domains</div><div class="toggle-desc">Allow tenants to use custom domains</div></div>
          <button class="toggle"></button>
        </div>
        <div class="toggle-row">
          <div><div class="toggle-label">api_v2</div><div class="toggle-desc">Enable v2 API endpoints</div></div>
          <button class="toggle on"></button>
        </div>
        <div class="toggle-row">
          <div><div class="toggle-label">sso_login</div><div class="toggle-desc">Single sign-on integration</div></div>
          <button class="toggle"></button>
        </div>
      </div>
    </div>

    <!-- Users & Teams Panel -->
    <div id="panel-users" class="panel">
      <h2>User & Team Management</h2>
      <div class="grid">
        <div class="card"><div class="label">Total Users</div><div class="value" id="users-total">—</div></div>
        <div class="card"><div class="label">Total Teams</div><div class="value" id="users-teams">—</div></div>
        <div class="card"><div class="label">Pending Invitations</div><div class="value" id="users-invites">—</div></div>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Tenant</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
        <tbody id="users-tbody"><tr><td colspan="6" style="text-align:center;color:#475569;">Connect to API to load users</td></tr></tbody>
      </table>
    </div>
  </div>

  <script>
    function showPanel(name) {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('panel-' + name).classList.add('active');
      event.target.classList.add('active');
    }
    function filterTenants() {
      const q = document.getElementById('tenant-search').value.toLowerCase();
      document.querySelectorAll('#tenants-tbody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }
    document.querySelectorAll('.toggle').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('on'));
    });
  </script>
</body>
</html>`
  }

  /**
   * Get full file listing for a SaaS starter template.
   */
  getTemplateFiles(options: SaasTemplateOptions): Record<string, string> {
    const schema = this.generateSchema()
    const _onboarding = this.generateOnboardingFlow()
    const _teamMgmt = this.generateTeamManagement()

    const files: Record<string, string> = {
      "schema.sql": schema,
      "src/config.ts": this.generateConfigFile(options),
      "src/auth.ts": this.generateAuthConfig(),
      "src/billing.ts": this.generateBillingConfig(),
      "src/admin/routes.ts": this.generateAdminRoutes(),
      ".env.example": this.generateEnvExample(),
      "README.md": this.generateReadme(options.name),
    }

    if (options.adminDashboard !== false) {
      files["src/admin/dashboard.html"] = this.generateAdminDashboard()
    }

    return files
  }

  // ─── Template File Generators ────────────────────────────────────────────

  private generateConfigFile(options: SaasTemplateOptions): string {
    return `import { defineConfig, jwtProvider } from "@reactivebase/server"
import { SaasKit, StripeBillingProvider } from "@reactivebase/server/tenant"

const stripe = new StripeBillingProvider({
  apiKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
})

export const saas = new SaasKit({
  billingProvider: stripe,
  defaultPlan: "${options.defaultPlan ?? "free"}",
})

export default defineConfig({
  database: {
    connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/${options.name}_dev",
    poolSize: 20,
  },
  server: { port: parseInt(process.env.PORT || "4000", 10) },
  auth: {
    providers: [
      jwtProvider({
        issuer: process.env.JWT_ISSUER || "https://auth.example.com",
        audience: process.env.JWT_AUDIENCE || "${options.name}-api",
      }),
    ],
  },
})
`
  }

  private generateAuthConfig(): string {
    return `// Auth configuration for SaaS template
export const authConfig = {
  jwtIssuer: process.env.JWT_ISSUER || "https://auth.example.com",
  jwtAudience: process.env.JWT_AUDIENCE || "my-saas-api",
  sessionDuration: "7d",
  refreshTokenDuration: "30d",
}
`
  }

  private generateBillingConfig(): string {
    return `// Billing configuration for SaaS template
import { StripeBillingProvider } from "@reactivebase/server/tenant"

export const billingProvider = new StripeBillingProvider({
  apiKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
})

export const plans = {
  free: { priceId: "", features: ["Basic access", "Community support"] },
  starter: { priceId: process.env.STRIPE_STARTER_PRICE_ID!, features: ["10 users", "Email support"] },
  pro: { priceId: process.env.STRIPE_PRO_PRICE_ID!, features: ["50 users", "Priority support", "SSO"] },
  enterprise: { priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID!, features: ["Unlimited", "SLA", "Dedicated support"] },
}
`
  }

  private generateAdminRoutes(): string {
    return `// Admin API routes for tenant management
import { SaasTemplateScaffold, StripeSubscriptionManager, TenantAnalytics } from "@reactivebase/server/tenant"

const scaffold = new SaasTemplateScaffold()
const analytics = new TenantAnalytics()

export const adminRoutes = {
  "GET /admin/dashboard": () => scaffold.generateAdminDashboard(),
  "GET /admin/analytics": (req: { query: { period?: string } }) =>
    analytics.getRevenueMetrics(req.query.period ?? "30d"),
  "GET /admin/tenants/:id/health": (req: { params: { id: string } }) =>
    analytics.getTenantHealth(req.params.id),
}
`
  }

  private generateEnvExample(): string {
    return `# Database
DATABASE_URL=postgresql://localhost:5432/myapp_dev
PORT=4000

# Auth
JWT_ISSUER=https://auth.example.com
JWT_AUDIENCE=my-saas-api

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...
`
  }

  private generateReadme(name: string): string {
    return `# ${name}

Multi-tenant SaaS built with [ReactiveBase](https://reactivebase.dev).

## Quick Start

\`\`\`bash
npm install
cp .env.example .env
# Edit .env with your database and Stripe credentials
npm run dev
\`\`\`

## Features

- Multi-tenant architecture with row-level isolation
- Team management with role-based access control
- Stripe billing integration (subscriptions, usage-based billing)
- Feature flags with per-tenant overrides
- Admin dashboard for tenant management
- Onboarding flow with workspace creation and team invite

## Project Structure

\`\`\`
${name}/
├── schema.sql           # Database schema (tenants, users, teams, roles, flags)
├── src/
│   ├── config.ts        # ReactiveBase + SaaS Kit configuration
│   ├── auth.ts          # Authentication configuration
│   ├── billing.ts       # Stripe billing setup
│   └── admin/
│       ├── routes.ts    # Admin API routes
│       └── dashboard.html
├── .env.example
└── README.md
\`\`\`

## Schema

- \`_rb_tenants\` — Multi-tenant organizations
- \`_rb_users\` — Users scoped to tenants
- \`_rb_teams\` — Teams within tenants
- \`_rb_roles\` — Custom roles with permissions
- \`_rb_invitations\` — Pending team invitations
- \`_rb_feature_flags\` — Global feature flags
- \`_rb_feature_flag_overrides\` — Per-tenant flag overrides
- \`_rb_usage_metrics\` — Usage tracking for billing
`
  }
}

// ─── Stripe Subscription Manager ─────────────────────────────────────────────

export class StripeSubscriptionManager {
  private config: { apiKey: string; apiBase: string; apiVersion: string }
  private subscriptions = new Map<string, SubscriptionStatus>()

  constructor(config: StripeConfig) {
    this.config = {
      apiKey: config.apiKey,
      apiBase: config.apiBase ?? "https://api.stripe.com",
      apiVersion: config.apiVersion ?? "2024-06-20",
    }
  }

  /**
   * Create a Stripe Checkout session for a tenant.
   */
  async createCheckoutSession(
    tenantId: string,
    planId: string,
    options?: { returnUrl?: string; trialDays?: number },
  ): Promise<CheckoutSession> {
    const body: Record<string, string> = {
      mode: "subscription",
      "line_items[0][price]": planId,
      "line_items[0][quantity]": "1",
      success_url: `${options?.returnUrl ?? "/billing"}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: options?.returnUrl ?? "/billing",
      "metadata[tenant_id]": tenantId,
    }

    if (options?.trialDays) {
      body["subscription_data[trial_period_days]"] = String(options.trialDays)
    }

    const res = await this.stripeRequest("POST", "/v1/checkout/sessions", body)

    return {
      id: res.id as string,
      url: res.url as string,
      tenantId,
      planId,
      status: (res.status as CheckoutSession["status"]) ?? "open",
    }
  }

  /**
   * Process a Stripe webhook event and update subscription state.
   */
  async handleWebhook(event: StripeWebhookEvent): Promise<{
    action: string
    tenantId: string | null
    details: Record<string, unknown>
  }> {
    const obj = event.data.object
    let action = "ignored"
    let tenantId: string | null = null
    const details: Record<string, unknown> = { eventId: event.id, type: event.type }

    switch (event.type) {
      case "customer.subscription.created": {
        action = "subscription_created"
        tenantId = (obj.metadata as Record<string, string>)?.tenant_id ?? null
        if (tenantId) {
          this.subscriptions.set(tenantId, {
            tenantId,
            planId:
              (((obj.items as Record<string, unknown>)?.data as Array<Record<string, unknown>>)?.[0]
                ?.price as string) ?? "",
            status: "active",
            currentPeriodStart: (obj.current_period_start as number) ?? Math.floor(Date.now() / 1000),
            currentPeriodEnd: (obj.current_period_end as number) ?? Math.floor(Date.now() / 1000) + 30 * 86400,
            cancelAtPeriodEnd: false,
            stripeSubscriptionId: obj.id as string,
            stripeCustomerId: obj.customer as string,
          })
        }
        break
      }
      case "customer.subscription.updated": {
        action = "subscription_updated"
        tenantId = (obj.metadata as Record<string, string>)?.tenant_id ?? null
        if (tenantId) {
          const existing = this.subscriptions.get(tenantId)
          if (existing) {
            existing.status = mapStripeStatus(obj.status as string)
            existing.cancelAtPeriodEnd = (obj.cancel_at_period_end as boolean) ?? false
            existing.currentPeriodEnd = (obj.current_period_end as number) ?? existing.currentPeriodEnd
          }
        }
        break
      }
      case "customer.subscription.deleted": {
        action = "subscription_cancelled"
        tenantId = (obj.metadata as Record<string, string>)?.tenant_id ?? null
        if (tenantId) {
          const existing = this.subscriptions.get(tenantId)
          if (existing) existing.status = "cancelled"
        }
        break
      }
      case "invoice.payment_failed": {
        action = "payment_failed"
        tenantId = (obj.metadata as Record<string, string>)?.tenant_id ?? null
        if (tenantId) {
          const existing = this.subscriptions.get(tenantId)
          if (existing) existing.status = "past_due"
        }
        details.amountDue = obj.amount_due
        details.attemptCount = obj.attempt_count
        break
      }
    }

    return { action, tenantId, details }
  }

  /**
   * Get current subscription status for a tenant.
   */
  getSubscriptionStatus(tenantId: string): SubscriptionStatus | null {
    return this.subscriptions.get(tenantId) ?? null
  }

  /**
   * Change a tenant's subscription plan.
   */
  async changePlan(tenantId: string, newPlanId: string): Promise<SubscriptionStatus> {
    const sub = this.subscriptions.get(tenantId)
    if (!sub?.stripeSubscriptionId) {
      throw new Error(`No active subscription found for tenant ${tenantId}`)
    }

    // Retrieve the subscription to get the item ID
    const current = await this.stripeRequest("GET", `/v1/subscriptions/${encodeURIComponent(sub.stripeSubscriptionId)}`)
    const items = (current.items as Record<string, unknown>)?.data as Array<Record<string, unknown>> | undefined
    const itemId = items?.[0]?.id as string

    if (!itemId) throw new Error("Could not find subscription item")

    await this.stripeRequest("POST", `/v1/subscriptions/${encodeURIComponent(sub.stripeSubscriptionId)}`, {
      "items[0][id]": itemId,
      "items[0][price]": newPlanId,
      proration_behavior: "create_prorations",
    })

    sub.planId = newPlanId
    return { ...sub }
  }

  /**
   * Record metered usage for billing.
   */
  async recordUsage(tenantId: string, metric: string, quantity: number): Promise<void> {
    const sub = this.subscriptions.get(tenantId)
    if (!sub?.stripeSubscriptionId) {
      throw new Error(`No active subscription found for tenant ${tenantId}`)
    }

    const current = await this.stripeRequest("GET", `/v1/subscriptions/${encodeURIComponent(sub.stripeSubscriptionId)}`)
    const items = (current.items as Record<string, unknown>)?.data as Array<Record<string, unknown>> | undefined
    const meteredItem = items?.find((item) => {
      const price = item.price as Record<string, unknown> | undefined
      return price?.recurring && (price.recurring as Record<string, unknown>).usage_type === "metered"
    })

    const itemId = (meteredItem?.id ?? items?.[0]?.id) as string
    if (!itemId) throw new Error("No subscription item found for usage recording")

    await this.stripeRequest("POST", "/v1/usage_records", {
      subscription_item: itemId,
      quantity: String(quantity),
      action: "increment",
      timestamp: String(Math.floor(Date.now() / 1000)),
    })
  }

  /**
   * Get invoice history for a tenant.
   */
  async getInvoices(tenantId: string): Promise<Invoice[]> {
    const sub = this.subscriptions.get(tenantId)
    if (!sub?.stripeCustomerId) return []

    const res = await this.stripeRequest(
      "GET",
      `/v1/invoices?customer=${encodeURIComponent(sub.stripeCustomerId)}&limit=100`,
    )
    const items = (res.data ?? []) as Array<Record<string, unknown>>
    return items.map((inv) => ({
      id: inv.id as string,
      customerId: inv.customer as string,
      amountDue: inv.amount_due as number,
      amountPaid: inv.amount_paid as number,
      currency: inv.currency as string,
      status: inv.status as Invoice["status"],
      periodStart: inv.period_start as number,
      periodEnd: inv.period_end as number,
      pdfUrl: (inv.invoice_pdf as string) ?? null,
    }))
  }

  /**
   * Cancel a tenant's subscription.
   */
  async cancelSubscription(tenantId: string, options?: { atPeriodEnd?: boolean; reason?: string }): Promise<void> {
    const sub = this.subscriptions.get(tenantId)
    if (!sub?.stripeSubscriptionId) {
      throw new Error(`No active subscription found for tenant ${tenantId}`)
    }

    if (options?.atPeriodEnd) {
      await this.stripeRequest("POST", `/v1/subscriptions/${encodeURIComponent(sub.stripeSubscriptionId)}`, {
        cancel_at_period_end: "true",
      })
      sub.cancelAtPeriodEnd = true
    } else {
      await this.stripeRequest("DELETE", `/v1/subscriptions/${encodeURIComponent(sub.stripeSubscriptionId)}`)
      sub.status = "cancelled"
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async stripeRequest(
    method: string,
    path: string,
    body?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.apiBase}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Stripe-Version": this.config.apiVersion,
    }

    const options: RequestInit = { method, headers }

    if (body && (method === "POST" || method === "PUT")) {
      headers["Content-Type"] = "application/x-www-form-urlencoded"
      options.body = new URLSearchParams(body).toString()
    }

    const res = await fetch(url, options)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Stripe API error (${res.status}): ${text}`)
    }

    return (await res.json()) as Record<string, unknown>
  }
}

function mapStripeStatus(status: string): SubscriptionStatus["status"] {
  switch (status) {
    case "active":
      return "active"
    case "past_due":
      return "past_due"
    case "canceled":
    case "cancelled":
      return "cancelled"
    case "trialing":
      return "trialing"
    case "paused":
      return "paused"
    default:
      return "active"
  }
}

// ─── Tenant Analytics ────────────────────────────────────────────────────────

export class TenantAnalytics {
  private usageRecords = new Map<string, UsageMetric[]>()
  private tenantData = new Map<
    string,
    { plan: string; createdAt: number; lastActiveAt: number; users: number; featuresUsed: number }
  >()

  /**
   * Get usage metrics for a tenant in a given period.
   */
  getUsageMetrics(
    tenantId: string,
    period: string,
  ): { apiCalls: number; storageMb: number; bandwidthMb: number; period: string } {
    const records = this.usageRecords.get(tenantId) ?? []
    const periodRecords = records.filter((r) => r.period === period)

    let apiCalls = 0
    let storageMb = 0
    let bandwidthMb = 0

    for (const record of periodRecords) {
      switch (record.metric) {
        case "api_calls":
          apiCalls += record.value
          break
        case "storage_mb":
          storageMb += record.value
          break
        case "bandwidth_mb":
          bandwidthMb += record.value
          break
      }
    }

    return { apiCalls, storageMb, bandwidthMb, period }
  }

  /**
   * Get revenue metrics across all tenants for a period.
   */
  getRevenueMetrics(period: string): RevenueMetrics {
    const tenants = Array.from(this.tenantData.values())
    const totalCustomers = tenants.length
    const payingCustomers = tenants.filter((t) => t.plan !== "free").length

    // Calculate MRR from plan data
    const planPrices: Record<string, number> = {
      free: 0,
      starter: 2900,
      pro: 9900,
      enterprise: 49900,
    }

    let mrr = 0
    const revenueByPlan: Record<string, number> = {}

    for (const tenant of tenants) {
      const price = planPrices[tenant.plan] ?? 0
      mrr += price
      revenueByPlan[tenant.plan] = (revenueByPlan[tenant.plan] ?? 0) + price
    }

    const arr = mrr * 12
    const churnRate = totalCustomers > 0 ? 0 : 0
    const avgLifetimeMonths = totalCustomers > 0 ? 24 : 0
    const ltv = totalCustomers > 0 ? (mrr / totalCustomers) * avgLifetimeMonths : 0
    const averageRevenuePerUser = totalCustomers > 0 ? Math.round(mrr / totalCustomers) : 0

    // Growth rate: tenants created in the period window
    const periodDays = parseInt(period) || 30
    const periodStart = Date.now() - periodDays * 24 * 60 * 60 * 1000
    const newTenants = tenants.filter((t) => t.createdAt >= periodStart)
    const growthRate = totalCustomers > 0 ? Math.round((newTenants.length / totalCustomers) * 10000) / 100 : 0

    return {
      mrr,
      arr,
      churnRate,
      ltv,
      totalCustomers,
      payingCustomers,
      averageRevenuePerUser,
      revenueByPlan,
      growthRate,
    }
  }

  /**
   * Get health score and risk indicators for a tenant.
   */
  getTenantHealth(tenantId: string): TenantHealthScore {
    const data = this.tenantData.get(tenantId)
    if (!data) {
      return {
        tenantId,
        score: 0,
        riskLevel: "critical",
        indicators: {
          apiUsageTrend: "declining",
          lastActiveAt: 0,
          daysSinceLastActivity: Infinity,
          planUtilization: 0,
          teamSize: 0,
          featureAdoption: 0,
        },
      }
    }

    const daysSinceLastActivity = Math.floor((Date.now() - data.lastActiveAt) / (24 * 60 * 60 * 1000))
    const planUtilization = Math.min(data.featuresUsed / 10, 1) * 100

    // Score calculation (0-100)
    let score = 100
    if (daysSinceLastActivity > 30) score -= 40
    else if (daysSinceLastActivity > 14) score -= 20
    else if (daysSinceLastActivity > 7) score -= 10
    if (data.users < 2) score -= 15
    if (planUtilization < 20) score -= 15
    if (data.plan === "free") score -= 10
    score = Math.max(0, Math.min(100, score))

    let riskLevel: TenantHealthScore["riskLevel"] = "healthy"
    if (score < 40) riskLevel = "critical"
    else if (score < 70) riskLevel = "at-risk"

    const apiUsageTrend: TenantHealthScore["indicators"]["apiUsageTrend"] =
      daysSinceLastActivity <= 3 ? "increasing" : daysSinceLastActivity <= 14 ? "stable" : "declining"

    return {
      tenantId,
      score,
      riskLevel,
      indicators: {
        apiUsageTrend,
        lastActiveAt: data.lastActiveAt,
        daysSinceLastActivity,
        planUtilization,
        teamSize: data.users,
        featureAdoption: data.featuresUsed,
      },
    }
  }

  /**
   * Generate a formatted analytics report.
   */
  generateReport(options: {
    period?: string
    format?: "text" | "json"
    includeHealth?: boolean
    tenantIds?: string[]
  }): string {
    const period = options.period ?? "30d"
    const revenue = this.getRevenueMetrics(period)

    if (options.format === "json") {
      const report: Record<string, unknown> = { period, revenue, generatedAt: new Date().toISOString() }

      if (options.includeHealth) {
        const ids = options.tenantIds ?? Array.from(this.tenantData.keys())
        report.tenantHealth = ids.map((id) => this.getTenantHealth(id))
      }

      return JSON.stringify(report, null, 2)
    }

    // Text format
    const lines: string[] = [
      "═══════════════════════════════════════════════════",
      "  ReactiveBase SaaS Analytics Report",
      `  Period: ${period}`,
      `  Generated: ${new Date().toISOString()}`,
      "═══════════════════════════════════════════════════",
      "",
      "── Revenue ────────────────────────────────────────",
      `  MRR:          $${(revenue.mrr / 100).toFixed(2)}`,
      `  ARR:          $${(revenue.arr / 100).toFixed(2)}`,
      `  Churn Rate:   ${revenue.churnRate}%`,
      `  LTV:          $${(revenue.ltv / 100).toFixed(2)}`,
      `  ARPU:         $${(revenue.averageRevenuePerUser / 100).toFixed(2)}`,
      "",
      "── Customers ──────────────────────────────────────",
      `  Total:        ${revenue.totalCustomers}`,
      `  Paying:       ${revenue.payingCustomers}`,
      `  Growth:       ${revenue.growthRate}%`,
      "",
      "── Revenue by Plan ────────────────────────────────",
      ...Object.entries(revenue.revenueByPlan).map(([plan, rev]) => `  ${plan.padEnd(14)} $${(rev / 100).toFixed(2)}`),
    ]

    if (options.includeHealth) {
      lines.push("", "── Tenant Health ──────────────────────────────────")
      const ids = options.tenantIds ?? Array.from(this.tenantData.keys())
      for (const id of ids) {
        const health = this.getTenantHealth(id)
        lines.push(`  ${id.padEnd(20)} Score: ${health.score}  Risk: ${health.riskLevel}`)
      }
    }

    lines.push("", "═══════════════════════════════════════════════════")
    return lines.join("\n")
  }

  // ─── Data Ingestion ─────────────────────────────────────────────────────

  /**
   * Record a usage metric for a tenant.
   */
  recordUsage(tenantId: string, metric: string, value: number, period: string): void {
    if (!this.usageRecords.has(tenantId)) {
      this.usageRecords.set(tenantId, [])
    }
    this.usageRecords.get(tenantId)!.push({
      tenantId,
      metric,
      value,
      period,
      recordedAt: Date.now(),
    })
  }

  /**
   * Register or update tenant data for analytics.
   */
  registerTenant(
    tenantId: string,
    data: { plan: string; createdAt: number; lastActiveAt: number; users: number; featuresUsed: number },
  ): void {
    this.tenantData.set(tenantId, data)
  }
}
