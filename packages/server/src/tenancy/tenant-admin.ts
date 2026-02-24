/**
 * Tenant Admin Dashboard for ReactiveBase SaaS Kit.
 * Provides analytics, tenant management, and a built-in admin HTML interface.
 *
 * Usage:
 *   const admin = new TenantAdminDashboard(saasKit)
 *   const overview = admin.getOverview()
 *   const html = admin.generateAdminHTML()
 */

import type { SaasKit, SaasTenant, SaasPlan } from "./saas-kit.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TenantOverview {
  totalTenants: number
  activeTenants: number
  suspendedTenants: number
  cancelledTenants: number
  mrr: number
  churnRate: number
  growthRate: number
  tenantsByPlan: Record<string, number>
  totalUsers: number
}

export interface TenantDetail {
  tenant: SaasTenant
  plan: SaasPlan | null
  monthlyRevenue: number
  usagePercent: Record<string, number>
  daysSinceCreation: number
}

export interface RevenueSummary {
  mrr: number
  arr: number
  revenueByPlan: Record<string, number>
  avgRevenuePerTenant: number
  totalTenants: number
  payingTenants: number
}

export interface TenantActivity {
  tenantId: string
  days: number
  timeline: TenantActivityEntry[]
}

export interface TenantActivityEntry {
  date: string
  apiCalls: number
  users: number
  storageMb: number
  subscriptions: number
}

// ─── Admin Dashboard ─────────────────────────────────────────────────────────

export class TenantAdminDashboard {
  private saas: SaasKit

  constructor(saas: SaasKit) {
    this.saas = saas
  }

  /**
   * Get a high-level overview of all tenants.
   */
  getOverview(): TenantOverview {
    const tenants = this.saas.listTenants()
    const plans = this.saas.getPlans()
    const active = tenants.filter((t) => t.status === "active")
    const suspended = tenants.filter((t) => t.status === "suspended")
    const cancelled = tenants.filter((t) => t.status === "cancelled")

    const byPlan: Record<string, number> = {}
    let mrr = 0
    let totalUsers = 0

    for (const tenant of tenants) {
      byPlan[tenant.plan] = (byPlan[tenant.plan] ?? 0) + 1
      totalUsers += tenant.usage.users
      if (tenant.status === "active") {
        const plan = plans.find((p) => p.id === tenant.plan)
        if (plan) mrr += plan.priceCents
      }
    }

    const churnRate = tenants.length > 0 ? Math.round((cancelled.length / tenants.length) * 10000) / 100 : 0

    // Growth rate: tenants created in last 30 days vs total
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const recentTenants = tenants.filter((t) => t.createdAt >= thirtyDaysAgo)
    const growthRate = tenants.length > 0 ? Math.round((recentTenants.length / tenants.length) * 10000) / 100 : 0

    return {
      totalTenants: tenants.length,
      activeTenants: active.length,
      suspendedTenants: suspended.length,
      cancelledTenants: cancelled.length,
      mrr,
      churnRate,
      growthRate,
      tenantsByPlan: byPlan,
      totalUsers,
    }
  }

  /**
   * Get detailed info for a specific tenant.
   */
  getTenantDetails(tenantId: string): TenantDetail {
    const tenant = this.saas.getTenant(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)

    const plans = this.saas.getPlans()
    const plan = plans.find((p) => p.id === tenant.plan) ?? null
    const monthlyRevenue = plan && tenant.status === "active" ? plan.priceCents : 0

    const usagePercent: Record<string, number> = {}
    if (plan) {
      const limits = plan.limits
      usagePercent.users = limits.maxUsers === Infinity ? 0 : Math.round((tenant.usage.users / limits.maxUsers) * 100)
      usagePercent.subscriptions =
        limits.maxSubscriptions === Infinity
          ? 0
          : Math.round((tenant.usage.subscriptions / limits.maxSubscriptions) * 100)
      usagePercent.storageMb =
        limits.maxStorageMb === Infinity ? 0 : Math.round((tenant.usage.storageMb / limits.maxStorageMb) * 100)
      usagePercent.apiCallsToday =
        limits.maxApiCallsPerDay === Infinity
          ? 0
          : Math.round((tenant.usage.apiCallsToday / limits.maxApiCallsPerDay) * 100)
    }

    const daysSinceCreation = Math.floor((Date.now() - tenant.createdAt) / (24 * 60 * 60 * 1000))

    return { tenant, plan, monthlyRevenue, usagePercent, daysSinceCreation }
  }

  /**
   * Search tenants by name, email, or plan.
   */
  searchTenants(query: string): SaasTenant[] {
    const q = query.toLowerCase()
    return this.saas
      .listTenants()
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.ownerEmail.toLowerCase().includes(q) ||
          t.plan.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q),
      )
  }

  /**
   * Get a tenant's activity timeline for the given number of days.
   * Returns synthetic timeline based on current usage snapshot.
   */
  getTenantActivity(tenantId: string, days: number): TenantActivity {
    const tenant = this.saas.getTenant(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)

    const timeline: TenantActivityEntry[] = []
    const now = Date.now()

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000)
      timeline.push({
        date: date.toISOString().split("T")[0],
        apiCalls: tenant.usage.apiCallsToday,
        users: tenant.usage.users,
        storageMb: tenant.usage.storageMb,
        subscriptions: tenant.usage.subscriptions,
      })
    }

    return { tenantId, days, timeline }
  }

  /**
   * Get revenue summary across all tenants.
   */
  getRevenueSummary(): RevenueSummary {
    const tenants = this.saas.listTenants()
    const plans = this.saas.getPlans()
    const revenueByPlan: Record<string, number> = {}
    let mrr = 0
    let payingTenants = 0

    for (const tenant of tenants) {
      if (tenant.status !== "active") continue
      const plan = plans.find((p) => p.id === tenant.plan)
      if (!plan) continue

      mrr += plan.priceCents
      revenueByPlan[plan.id] = (revenueByPlan[plan.id] ?? 0) + plan.priceCents

      if (plan.priceCents > 0) payingTenants++
    }

    return {
      mrr,
      arr: mrr * 12,
      revenueByPlan,
      avgRevenuePerTenant: tenants.length > 0 ? Math.round(mrr / tenants.length) : 0,
      totalTenants: tenants.length,
      payingTenants,
    }
  }

  /**
   * Generate a self-contained admin dashboard HTML page.
   */
  generateAdminHTML(): string {
    const overview = this.getOverview()
    const revenue = this.getRevenueSummary()
    const tenants = this.saas.listTenants()

    const tenantRows = tenants
      .map(
        (t) => `
        <tr>
          <td>${escapeHtml(t.name)}</td>
          <td>${escapeHtml(t.slug)}</td>
          <td><span class="badge badge-${t.status}">${t.status}</span></td>
          <td>${escapeHtml(t.plan)}</td>
          <td>${escapeHtml(t.ownerEmail)}</td>
          <td>${t.usage.users}</td>
          <td>${new Date(t.createdAt).toLocaleDateString()}</td>
        </tr>`,
      )
      .join("")

    const planDistribution = Object.entries(overview.tenantsByPlan)
      .map(([plan, count]) => `<li><strong>${escapeHtml(plan)}</strong>: ${count}</li>`)
      .join("")

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactiveBase - Tenant Admin Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; margin-bottom: 24px; color: #111; }
    h2 { font-size: 18px; margin-bottom: 16px; color: #333; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card .label { font-size: 12px; text-transform: uppercase; color: #666; margin-bottom: 4px; }
    .card .value { font-size: 28px; font-weight: 700; color: #111; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #fafafa; font-size: 12px; text-transform: uppercase; color: #666; }
    .badge { padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge-active { background: #dcfce7; color: #166534; }
    .badge-suspended { background: #fef3c7; color: #92400e; }
    .badge-cancelled { background: #fee2e2; color: #991b1b; }
    .badge-onboarding { background: #dbeafe; color: #1e40af; }
    .section { margin-bottom: 32px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🏢 Tenant Admin Dashboard</h1>
    <div class="grid">
      <div class="card"><div class="label">Total Tenants</div><div class="value">${overview.totalTenants}</div></div>
      <div class="card"><div class="label">Active</div><div class="value">${overview.activeTenants}</div></div>
      <div class="card"><div class="label">MRR</div><div class="value">$${(revenue.mrr / 100).toFixed(2)}</div></div>
      <div class="card"><div class="label">ARR</div><div class="value">$${(revenue.arr / 100).toFixed(2)}</div></div>
      <div class="card"><div class="label">Churn Rate</div><div class="value">${overview.churnRate}%</div></div>
      <div class="card"><div class="label">Paying Tenants</div><div class="value">${revenue.payingTenants}</div></div>
      <div class="card"><div class="label">Total Users</div><div class="value">${overview.totalUsers}</div></div>
    </div>
    <div class="section">
      <h2>Plan Distribution</h2>
      <ul style="list-style:none;padding:0;">${planDistribution}</ul>
    </div>
    <div class="section">
      <h2>All Tenants</h2>
      <table>
        <thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Plan</th><th>Email</th><th>Users</th><th>Created</th></tr></thead>
        <tbody>${tenantRows || "<tr><td colspan='7' style='text-align:center;color:#999;'>No tenants yet</td></tr>"}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
