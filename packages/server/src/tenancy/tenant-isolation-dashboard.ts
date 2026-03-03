/**
 * Multi-Tenant Isolation Dashboard for ReactiveBase.
 *
 * Extends the existing tenancy/ module with:
 *   - Tenant CRUD operations
 *   - Resource usage per tenant (queries, storage, connections)
 *   - Tenant-scoped query debugger
 *   - Data export/import per tenant
 *   - Tenant switching in the developer dashboard
 *   - Self-contained HTML dashboard
 *
 * Usage:
 *   const dashboard = new TenantIsolationDashboard(config)
 *   dashboard.createTenant({ id: "t1", name: "Acme" })
 *   const usage = dashboard.getResourceUsage("t1")
 *   const html = dashboard.generateDashboardHTML()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TenantRecord {
  id: string
  name: string
  slug: string
  mode: "row" | "schema"
  status: "active" | "suspended" | "onboarding" | "deleted"
  createdAt: number
  updatedAt: number
  metadata: Record<string, unknown>
}

export interface TenantResourceUsage {
  tenantId: string
  queryCount: number
  mutationCount: number
  activeSubscriptions: number
  storageBytes: number
  connectionCount: number
  lastActivityAt: number | null
  periodStart: number
  periodEnd: number
}

export interface TenantQueryLog {
  tenantId: string
  queryName: string
  args: unknown
  durationMs: number
  timestamp: number
  status: "success" | "error"
  error?: string
}

export interface TenantExportData {
  tenant: TenantRecord
  tables: Record<string, unknown[]>
  exportedAt: string
  format: "json"
}

export interface CreateTenantRequest {
  id?: string
  name: string
  slug?: string
  mode?: "row" | "schema"
  metadata?: Record<string, unknown>
}

export interface TenantDashboardOptions {
  defaultMode?: "row" | "schema"
  maxTenantsDisplayed?: number
  queryLogRetention?: number
}

// ─── Tenant Isolation Dashboard ──────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<TenantDashboardOptions> = {
  defaultMode: "row",
  maxTenantsDisplayed: 100,
  queryLogRetention: 1000,
}

export class TenantIsolationDashboard {
  private options: Required<TenantDashboardOptions>
  private tenants = new Map<string, TenantRecord>()
  private usage = new Map<string, TenantResourceUsage>()
  private queryLogs = new Map<string, TenantQueryLog[]>()
  private activeTenantId: string | null = null
  private tenantCounter = 0

  constructor(options: TenantDashboardOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  // ─── Tenant CRUD ─────────────────────────────────────────────────────

  createTenant(request: CreateTenantRequest): TenantRecord {
    if (!request.name || request.name.trim().length === 0) {
      throw new TenantDashboardError("Tenant name is required")
    }

    const id = request.id ?? `tenant_${++this.tenantCounter}_${Date.now().toString(36)}`

    if (this.tenants.has(id)) {
      throw new TenantDashboardError(`Tenant "${id}" already exists`)
    }

    const slug =
      request.slug ??
      request.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")

    const tenant: TenantRecord = {
      id,
      name: request.name,
      slug,
      mode: request.mode ?? this.options.defaultMode,
      status: "onboarding",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: request.metadata ?? {},
    }

    this.tenants.set(id, tenant)
    this.usage.set(id, createEmptyUsage(id))
    this.queryLogs.set(id, [])

    return tenant
  }

  getTenant(id: string): TenantRecord | undefined {
    return this.tenants.get(id)
  }

  updateTenant(
    id: string,
    updates: Partial<Pick<TenantRecord, "name" | "slug" | "status" | "metadata">>,
  ): TenantRecord {
    const tenant = this.tenants.get(id)
    if (!tenant) throw new TenantDashboardError(`Tenant "${id}" not found`)

    if (updates.name !== undefined) tenant.name = updates.name
    if (updates.slug !== undefined) tenant.slug = updates.slug
    if (updates.status !== undefined) tenant.status = updates.status
    if (updates.metadata !== undefined) tenant.metadata = { ...tenant.metadata, ...updates.metadata }
    tenant.updatedAt = Date.now()

    return tenant
  }

  deleteTenant(id: string): void {
    const tenant = this.tenants.get(id)
    if (!tenant) throw new TenantDashboardError(`Tenant "${id}" not found`)

    tenant.status = "deleted"
    tenant.updatedAt = Date.now()

    if (this.activeTenantId === id) {
      this.activeTenantId = null
    }
  }

  listTenants(filter?: { status?: TenantRecord["status"] }): TenantRecord[] {
    let tenants = [...this.tenants.values()]
    if (filter?.status) {
      tenants = tenants.filter((t) => t.status === filter.status)
    }
    return tenants.slice(0, this.options.maxTenantsDisplayed)
  }

  // ─── Tenant Switching ────────────────────────────────────────────────

  switchTenant(tenantId: string): TenantRecord {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new TenantDashboardError(`Tenant "${tenantId}" not found`)
    if (tenant.status !== "active" && tenant.status !== "onboarding") {
      throw new TenantDashboardError(`Cannot switch to ${tenant.status} tenant`)
    }

    this.activeTenantId = tenantId
    return tenant
  }

  getActiveTenant(): TenantRecord | null {
    return this.activeTenantId ? (this.tenants.get(this.activeTenantId) ?? null) : null
  }

  // ─── Resource Usage ──────────────────────────────────────────────────

  getResourceUsage(tenantId: string): TenantResourceUsage | undefined {
    return this.usage.get(tenantId)
  }

  recordQuery(
    tenantId: string,
    queryName: string,
    args: unknown,
    durationMs: number,
    status: "success" | "error",
    error?: string,
  ): void {
    const usageRecord = this.usage.get(tenantId)
    if (usageRecord) {
      usageRecord.queryCount++
      usageRecord.lastActivityAt = Date.now()
    }

    const logs = this.queryLogs.get(tenantId) ?? []
    logs.push({
      tenantId,
      queryName,
      args,
      durationMs,
      timestamp: Date.now(),
      status,
      error,
    })

    // Enforce retention limit
    if (logs.length > this.options.queryLogRetention) {
      logs.splice(0, logs.length - this.options.queryLogRetention)
    }

    this.queryLogs.set(tenantId, logs)
  }

  recordMutation(tenantId: string): void {
    const usageRecord = this.usage.get(tenantId)
    if (usageRecord) {
      usageRecord.mutationCount++
      usageRecord.lastActivityAt = Date.now()
    }
  }

  updateStorageUsage(tenantId: string, storageBytes: number): void {
    const usageRecord = this.usage.get(tenantId)
    if (usageRecord) {
      usageRecord.storageBytes = storageBytes
    }
  }

  // ─── Query Debugger ──────────────────────────────────────────────────

  getQueryLogs(tenantId: string, limit?: number): TenantQueryLog[] {
    const logs = this.queryLogs.get(tenantId) ?? []
    return logs.slice(-(limit ?? 50)).reverse()
  }

  getSlowQueries(tenantId: string, thresholdMs: number = 100): TenantQueryLog[] {
    const logs = this.queryLogs.get(tenantId) ?? []
    return logs.filter((l) => l.durationMs >= thresholdMs).sort((a, b) => b.durationMs - a.durationMs)
  }

  getFailedQueries(tenantId: string): TenantQueryLog[] {
    const logs = this.queryLogs.get(tenantId) ?? []
    return logs.filter((l) => l.status === "error").reverse()
  }

  // ─── Data Export/Import ──────────────────────────────────────────────

  exportTenantData(tenantId: string): TenantExportData {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new TenantDashboardError(`Tenant "${tenantId}" not found`)

    return {
      tenant,
      tables: {},
      exportedAt: new Date().toISOString(),
      format: "json",
    }
  }

  importTenantData(data: TenantExportData): TenantRecord {
    if (!data.tenant) {
      throw new TenantDashboardError("Invalid import data: missing tenant record")
    }

    const existing = this.tenants.get(data.tenant.id)
    if (existing) {
      throw new TenantDashboardError(`Tenant "${data.tenant.id}" already exists. Delete it first.`)
    }

    const tenant: TenantRecord = {
      ...data.tenant,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.tenants.set(tenant.id, tenant)
    this.usage.set(tenant.id, createEmptyUsage(tenant.id))
    this.queryLogs.set(tenant.id, [])

    return tenant
  }

  // ─── Dashboard Overview ──────────────────────────────────────────────

  getOverview(): {
    totalTenants: number
    activeTenants: number
    totalQueries: number
    totalMutations: number
    totalStorageBytes: number
    currentTenant: string | null
  } {
    const tenants = [...this.tenants.values()]
    const usages = [...this.usage.values()]

    return {
      totalTenants: tenants.filter((t) => t.status !== "deleted").length,
      activeTenants: tenants.filter((t) => t.status === "active").length,
      totalQueries: usages.reduce((sum, u) => sum + u.queryCount, 0),
      totalMutations: usages.reduce((sum, u) => sum + u.mutationCount, 0),
      totalStorageBytes: usages.reduce((sum, u) => sum + u.storageBytes, 0),
      currentTenant: this.activeTenantId,
    }
  }

  // ─── HTML Dashboard ──────────────────────────────────────────────────

  generateDashboardHTML(): string {
    const overview = this.getOverview()
    const tenants = this.listTenants()

    const tenantRows = tenants
      .filter((t) => t.status !== "deleted")
      .map((t) => {
        const usage = this.usage.get(t.id)
        const isCurrent = t.id === this.activeTenantId
        return `<tr class="${isCurrent ? "current-tenant" : ""}">
          <td>${esc(t.name)}${isCurrent ? ' <span class="badge-current">current</span>' : ""}</td>
          <td>${esc(t.slug)}</td>
          <td><span class="badge-${t.status}">${t.status}</span></td>
          <td>${t.mode}</td>
          <td>${usage?.queryCount ?? 0}</td>
          <td>${usage?.mutationCount ?? 0}</td>
          <td>${formatBytes(usage?.storageBytes ?? 0)}</td>
          <td>${usage?.activeSubscriptions ?? 0}</td>
          <td>${new Date(t.createdAt).toLocaleDateString()}</td>
        </tr>`
      })
      .join("\n")

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactiveBase — Tenant Isolation Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #f0f6fc; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #f0f6fc; }
    .subtitle { color: #8b949e; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; text-align: center; }
    .card .label { font-size: 11px; text-transform: uppercase; color: #8b949e; margin-bottom: 4px; }
    .card .value { font-size: 24px; font-weight: 700; color: #f0f6fc; }
    .section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 24px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 600; font-size: 11px; text-transform: uppercase; }
    .badge-active { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #238636; color: #fff; }
    .badge-suspended { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #9e6a03; color: #fff; }
    .badge-onboarding { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #1f6feb; color: #fff; }
    .badge-deleted { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #da3633; color: #fff; }
    .badge-current { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #8957e5; color: #fff; margin-left: 4px; }
    .current-tenant { background: rgba(137, 87, 229, 0.08); }
  </style>
</head>
<body>
  <h1>🏢 Tenant Isolation Dashboard</h1>
  <p class="subtitle">${overview.totalTenants} tenants · ${overview.activeTenants} active · ${overview.currentTenant ? `Current: ${overview.currentTenant}` : "No tenant selected"}</p>

  <div class="grid">
    <div class="card"><div class="label">Total Tenants</div><div class="value">${overview.totalTenants}</div></div>
    <div class="card"><div class="label">Active</div><div class="value">${overview.activeTenants}</div></div>
    <div class="card"><div class="label">Total Queries</div><div class="value">${overview.totalQueries}</div></div>
    <div class="card"><div class="label">Total Mutations</div><div class="value">${overview.totalMutations}</div></div>
    <div class="card"><div class="label">Total Storage</div><div class="value">${formatBytes(overview.totalStorageBytes)}</div></div>
  </div>

  <h2>All Tenants</h2>
  <div class="section">
    <table>
      <thead><tr>
        <th>Name</th><th>Slug</th><th>Status</th><th>Mode</th>
        <th>Queries</th><th>Mutations</th><th>Storage</th><th>Subscriptions</th><th>Created</th>
      </tr></thead>
      <tbody>${tenantRows || '<tr><td colspan="9" style="text-align:center;color:#484f58">No tenants</td></tr>'}</tbody>
    </table>
  </div>
</body>
</html>`
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createEmptyUsage(tenantId: string): TenantResourceUsage {
  const now = Date.now()
  return {
    tenantId,
    queryCount: 0,
    mutationCount: 0,
    activeSubscriptions: 0,
    storageBytes: 0,
    connectionCount: 0,
    lastActivityAt: null,
    periodStart: now,
    periodEnd: now + 30 * 24 * 60 * 60 * 1000,
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class TenantDashboardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TenantDashboardError"
  }
}
