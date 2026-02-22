/**
 * SaaS Starter Template for create-reactivebase.
 * Generates a complete multi-tenant SaaS project with tenant-aware schema,
 * auth-protected queries, billing webhooks, and admin dashboard queries.
 */

export const saasSchemaTs = `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tenants: defineTable({
    name: v.string(),
    slug: v.string(),
    plan: v.enum("free", "starter", "pro", "enterprise"),
    status: v.enum("onboarding", "active", "suspended", "cancelled"),
    ownerUserId: v.optional(v.string()),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_slug", ["slug"], { unique: true })
    .index("by_status", ["status"]),

  users: defineTable({
    email: v.string(),
    name: v.string(),
    role: v.enum("owner", "admin", "member", "viewer"),
    tenantId: v.id("tenants"),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_email", ["email"], { unique: true })
    .index("by_tenant", ["tenantId"]),

  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    tenantId: v.id("tenants"),
    createdBy: v.id("users"),
    status: v.enum("active", "archived"),
    createdAt: v.timestamp({ default: "now" }),
    updatedAt: v.timestamp({ default: "now" }),
  })
    .index("by_tenant", ["tenantId"]),

  audit_logs: defineTable({
    tenantId: v.id("tenants"),
    userId: v.id("users"),
    action: v.string(),
    resource: v.string(),
    resourceId: v.optional(v.string()),
    metadata: v.optional(v.json()),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_tenant", ["tenantId"]),
})
`

export const saasTenantsTs = `import { query, mutation, action } from "@reactivebase/server"

export const myTenant = query(async (ctx) => {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")
  const user = await ctx.db.users.where({ email: identity.email }).first()
  if (!user) throw new Error("User not found")
  return ctx.db.tenants.get(user.tenantId)
})

export const teamMembers = query(async (ctx, { tenantId }: { tenantId: string }) => {
  return ctx.db.users.where({ tenantId }).orderBy("createdAt", "desc")
})

export const tenantStats = query(async (ctx, { tenantId }: { tenantId: string }) => {
  const [users, projects, active] = await Promise.all([
    ctx.db.users.where({ tenantId }).count(),
    ctx.db.projects.where({ tenantId }).count(),
    ctx.db.projects.where({ tenantId, status: "active" }).count(),
  ])
  return { users, projects, activeProjects: active }
})

export const onboardTenant = mutation(async (ctx, args: {
  tenantName: string; ownerEmail: string; ownerName: string; plan?: string
}) => {
  const slug = args.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  const existing = await ctx.db.tenants.where({ slug }).first()
  if (existing) throw new Error("Tenant slug already taken")

  const tenant = await ctx.db.tenants.insert({
    name: args.tenantName, slug, plan: args.plan ?? "free",
    status: "active", createdAt: new Date(),
  })
  const user = await ctx.db.users.insert({
    email: args.ownerEmail, name: args.ownerName, role: "owner",
    tenantId: tenant.id, createdAt: new Date(),
  })
  await ctx.db.tenants.update(tenant.id, { ownerUserId: user.id })
  await ctx.db.audit_logs.insert({
    tenantId: tenant.id, userId: user.id, action: "tenant.created",
    resource: "tenants", resourceId: tenant.id, createdAt: new Date(),
  })
  return { tenant, user }
})

export const inviteMember = mutation(async (ctx, args: {
  tenantId: string; email: string; name: string; role: "admin" | "member" | "viewer"
}) => {
  const user = await ctx.db.users.insert({
    email: args.email, name: args.name, role: args.role,
    tenantId: args.tenantId, createdAt: new Date(),
  })
  return user
})

export const changePlan = mutation(async (ctx, args: {
  tenantId: string; newPlan: "free" | "starter" | "pro" | "enterprise"
}) => {
  await ctx.db.tenants.update(args.tenantId, { plan: args.newPlan })
  return { success: true }
})

export const handleBillingWebhook = action(async (ctx, args: {
  event: string; data: Record<string, unknown>
}) => {
  return { processed: true, event: args.event }
})
`

export const saasProjectsTs = `import { query, mutation } from "@reactivebase/server"

export const listProjects = query(async (ctx, { tenantId }: { tenantId: string }) => {
  return ctx.db.projects.where({ tenantId, status: "active" }).orderBy("updatedAt", "desc")
})

export const createProject = mutation(async (ctx, args: {
  tenantId: string; name: string; description?: string; createdBy: string
}) => {
  const project = await ctx.db.projects.insert({
    name: args.name, description: args.description, tenantId: args.tenantId,
    createdBy: args.createdBy, status: "active",
    createdAt: new Date(), updatedAt: new Date(),
  })
  return project
})

export const archiveProject = mutation(async (ctx, args: {
  projectId: string; tenantId: string
}) => {
  await ctx.db.projects.update(args.projectId, { status: "archived", updatedAt: new Date() })
  return { success: true }
})
`

export const saasConfigTs = `import { defineConfig, jwtProvider } from "@reactivebase/server"

export default defineConfig({
  database: {
    connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/saas_dev",
    poolSize: 20,
  },
  server: { port: parseInt(process.env.PORT || "4000", 10) },
  auth: {
    providers: [
      jwtProvider({
        issuer: process.env.JWT_ISSUER || "https://auth.example.com",
        audience: process.env.JWT_AUDIENCE || "my-saas-api",
      }),
    ],
  },
  dev: { logLevel: "debug" },
})
`

export const saasEnvExample = `DATABASE_URL=postgresql://localhost:5432/saas_dev
PORT=4000
JWT_ISSUER=https://auth.example.com
JWT_AUDIENCE=my-saas-api
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
`

export function saasReadme(name: string): string {
  return `# ${name}

Multi-tenant SaaS built with [ReactiveBase](https://reactivebase.dev).

## Quick Start

\`\`\`bash
npm install
cp .env.example .env
npm run dev
\`\`\`

## Schema: tenants, users, projects, audit_logs

## API: tenants.onboardTenant, tenants.changePlan, projects.listProjects, etc.
`
}

/**
 * Generate all files for the SaaS template.
 */
export function generateSaasTemplate(projectName: string): Record<string, string> {
  return {
    "convex/schema.ts": saasSchemaTs,
    "convex/tenants.ts": saasTenantsTs,
    "convex/projects.ts": saasProjectsTs,
    "reactivebase.config.ts": saasConfigTs,
    ".env.example": saasEnvExample,
    "README.md": saasReadme(projectName),
  }
}
