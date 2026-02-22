import { query, mutation } from "@reactivebase/server"

// ─── Reactive Dashboard Queries ──────────────────────────────────────────────

export const overview = query(async (ctx, { tenantId }: { tenantId: string }) => {
  const [totalEvents, pageviews, conversions, signups] = await Promise.all([
    ctx.db.events.where({ tenantId }).count(),
    ctx.db.events.where({ tenantId, type: "pageview" }).count(),
    ctx.db.events.where({ tenantId, type: "conversion" }).count(),
    ctx.db.events.where({ tenantId, type: "signup" }).count(),
  ])
  const conversionRate = pageviews > 0 ? conversions / pageviews : 0
  return { totalEvents, pageviews, conversions, signups, conversionRate }
})

export const recentEvents = query(async (ctx, { tenantId, limit }: { tenantId: string; limit?: number }) => {
  return ctx.db.events.where({ tenantId }).orderBy("createdAt", "desc").limit(limit ?? 50)
})

export const metricHistory = query(async (ctx, { tenantId, metricName }: { tenantId: string; metricName: string }) => {
  return ctx.db.metrics.where({ tenantId, name: metricName }).orderBy("computedAt", "desc").limit(30)
})

export const activeAlerts = query(async (ctx, { tenantId }: { tenantId: string }) => {
  return ctx.db.alerts.where({ tenantId, status: "triggered" })
})

// ─── Event Ingestion ─────────────────────────────────────────────────────────

export const trackEvent = mutation(async (ctx, args: {
  tenantId: string; type: string; name: string; properties?: Record<string, unknown>; sessionId?: string; userId?: string
}) => {
  return ctx.db.events.insert({
    tenantId: args.tenantId, type: args.type as any, name: args.name,
    properties: args.properties, sessionId: args.sessionId,
    userId: args.userId, createdAt: new Date(),
  })
})

export const createAlert = mutation(async (ctx, args: {
  tenantId: string; metricName: string; threshold: number; direction: "above" | "below"
}) => {
  return ctx.db.alerts.insert({
    tenantId: args.tenantId, metricName: args.metricName,
    threshold: args.threshold, direction: args.direction,
    status: "active", createdAt: new Date(),
  })
})
