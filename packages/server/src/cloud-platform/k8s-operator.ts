/**
 * Multi-tenant Kubernetes operator for ReactiveBase Cloud.
 * Manages tenant lifecycle including provisioning, scaling, and teardown
 * with isolated Postgres instances per tenant.
 */

import { createIdGenerator } from "./id-generator.js"
import type { ReactiveBaseCluster, TenantConfig, TenantStatus, ClusterHealth } from "./k8s-types.js"
import { PLAN_TENANT_DEFAULTS } from "./k8s-types.js"

export class KubernetesOperator {
  private cluster: ReactiveBaseCluster
  private tenants = new Map<string, TenantStatus>()
  private generateId = createIdGenerator()

  constructor(clusterConfig?: Partial<ReactiveBaseCluster>) {
    this.cluster = {
      id: clusterConfig?.id ?? `cluster_${Date.now().toString(36)}`,
      name: clusterConfig?.name ?? "reactivebase-primary",
      region: clusterConfig?.region ?? "us-east-1",
      kubernetesVersion: clusterConfig?.kubernetesVersion ?? "1.29",
      nodeCount: clusterConfig?.nodeCount ?? 3,
      status: "running",
      tenants: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  // ─── Reconciliation ───────────────────────────────────────────────────

  async reconcile(cluster: ReactiveBaseCluster): Promise<ReactiveBaseCluster> {
    for (const tenantId of cluster.tenants) {
      const tenant = this.tenants.get(tenantId)
      if (!tenant) continue

      if (tenant.replicas !== tenant.desiredReplicas) {
        tenant.replicas = tenant.desiredReplicas
        tenant.status = "running"
        tenant.updatedAt = new Date().toISOString()
      }
    }

    const allTenants = [...this.tenants.values()]
    const errorTenants = allTenants.filter((t) => t.status === "error")
    if (errorTenants.length > allTenants.length * 0.5) {
      cluster.status = "degraded"
    } else {
      cluster.status = "running"
    }

    cluster.tenants = [...this.tenants.keys()]
    cluster.updatedAt = new Date().toISOString()
    this.cluster = cluster

    return cluster
  }

  // ─── Tenant Management ────────────────────────────────────────────────

  async provisionTenant(tenantId: string, config: TenantConfig): Promise<TenantStatus> {
    if (this.tenants.has(tenantId)) {
      throw new Error(`Tenant ${tenantId} already exists`)
    }

    const defaults = PLAN_TENANT_DEFAULTS[config.plan]
    const namespace = `rb-tenant-${tenantId}`
    const storageSizeGb = config.storageSizeGb ?? defaults.storage
    const replicas = config.replicas ?? defaults.replicas

    const tenant: TenantStatus = {
      tenantId,
      clusterId: this.cluster.id,
      namespace,
      status: "provisioning",
      replicas: 0,
      desiredReplicas: replicas,
      postgresUrl: `postgresql://rb_${tenantId}:****@pg-${namespace}.${config.region}.reactivebase.cloud:5432/rb_${tenantId}`,
      storageSizeGb,
      cpuUsagePercent: 0,
      memoryUsagePercent: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.tenants.set(tenantId, tenant)
    this.cluster.tenants.push(tenantId)
    this.cluster.updatedAt = new Date().toISOString()

    // Simulate provisioning completion
    tenant.status = "running"
    tenant.replicas = replicas
    tenant.updatedAt = new Date().toISOString()

    return tenant
  }

  async scaleTenant(tenantId: string, replicas: number): Promise<TenantStatus> {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)

    if (replicas < 0) throw new Error("Replicas must be non-negative")

    tenant.status = "scaling"
    tenant.desiredReplicas = replicas
    tenant.updatedAt = new Date().toISOString()

    // Simulate scaling completion
    tenant.replicas = replicas
    tenant.status = "running"
    tenant.updatedAt = new Date().toISOString()

    return tenant
  }

  async deleteTenant(tenantId: string): Promise<void> {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)

    tenant.status = "deleting"
    tenant.updatedAt = new Date().toISOString()

    this.tenants.delete(tenantId)
    this.cluster.tenants = this.cluster.tenants.filter((id) => id !== tenantId)
    this.cluster.updatedAt = new Date().toISOString()
  }

  // ─── Cluster Status ───────────────────────────────────────────────────

  getClusterStatus(): ClusterHealth {
    const allTenants = [...this.tenants.values()]
    const activeTenants = allTenants.filter((t) => t.status === "running")
    const totalCpu = allTenants.reduce((sum, t) => sum + t.cpuUsagePercent, 0)
    const totalMemory = allTenants.reduce((sum, t) => sum + t.memoryUsagePercent, 0)
    const tenantCount = Math.max(allTenants.length, 1)

    const avgCpu = totalCpu / tenantCount
    const avgMemory = totalMemory / tenantCount

    let status: ClusterHealth["status"] = "healthy"
    if (avgCpu > 90 || avgMemory > 90) {
      status = "unhealthy"
    } else if (avgCpu > 75 || avgMemory > 75) {
      status = "degraded"
    }

    return {
      clusterId: this.cluster.id,
      status,
      nodeCount: this.cluster.nodeCount,
      readyNodes: this.cluster.status === "running" ? this.cluster.nodeCount : 0,
      totalTenants: allTenants.length,
      activeTenants: activeTenants.length,
      cpuAllocatedPercent: avgCpu,
      memoryAllocatedPercent: avgMemory,
      kubernetesVersion: this.cluster.kubernetesVersion,
      checkedAt: new Date().toISOString(),
    }
  }

  listTenants(): TenantStatus[] {
    return [...this.tenants.values()]
  }

  getTenant(tenantId: string): TenantStatus | undefined {
    return this.tenants.get(tenantId)
  }
}
