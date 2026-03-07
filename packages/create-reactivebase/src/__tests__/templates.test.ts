/**
 * Template output validation tests — verifies that each template
 * produces valid schema definitions, function handlers, server setup,
 * and documentation.
 */

import { describe, it, expect } from "vitest"
import { todoSchemaTs, todoFunctionsTs, todoServerTs, todoReadmeMd } from "../templates/todo.js"
import { chatSchemaTs, chatFunctionsTs, chatServerTs, chatReadmeMd } from "../templates/chat.js"
import {
  saasSchemaTs,
  saasTenantsTs,
  saasProjectsTs,
  saasConfigTs,
  saasEnvExample,
  saasAdminTs,
} from "../templates/saas.js"

// ─── Todo Template ──────────────────────────────────────────────────────────

describe("todo template", () => {
  it("exports all required template constants", () => {
    expect(typeof todoSchemaTs).toBe("string")
    expect(typeof todoFunctionsTs).toBe("string")
    expect(typeof todoServerTs).toBe("string")
    expect(typeof todoReadmeMd).toBe("string")
  })

  it("schema uses defineSchema and defineTable", () => {
    expect(todoSchemaTs).toContain("defineSchema")
    expect(todoSchemaTs).toContain("defineTable")
    expect(todoSchemaTs).toContain("@reactivebase/server")
  })

  it("schema defines tasks and users tables", () => {
    expect(todoSchemaTs).toContain("tasks:")
    expect(todoSchemaTs).toContain("users:")
  })

  it("schema has proper field types", () => {
    expect(todoSchemaTs).toContain("v.string()")
    expect(todoSchemaTs).toContain("v.boolean(")
    expect(todoSchemaTs).toContain("v.enum(")
  })

  it("schema includes indexes", () => {
    expect(todoSchemaTs).toContain(".index(")
  })

  it("functions import query and mutation from server", () => {
    expect(todoFunctionsTs).toContain("import { query, mutation }")
    expect(todoFunctionsTs).toContain("@reactivebase/server")
  })

  it("functions define CRUD operations", () => {
    expect(todoFunctionsTs).toContain("listTasks")
    expect(todoFunctionsTs).toContain("createTask")
    expect(todoFunctionsTs).toContain("toggleTask")
    expect(todoFunctionsTs).toContain("deleteTask")
  })

  it("functions use ctx.db for data access", () => {
    expect(todoFunctionsTs).toContain("ctx.db.tasks")
  })

  it("server imports createReactiveBaseServer", () => {
    expect(todoServerTs).toContain("createReactiveBaseServer")
    expect(todoServerTs).toContain("server.start()")
  })

  it("readme has title and getting started", () => {
    expect(todoReadmeMd).toContain("# Todo App")
    expect(todoReadmeMd).toContain("npm install")
    expect(todoReadmeMd).toContain("npm run dev")
  })
})

// ─── Chat Template ──────────────────────────────────────────────────────────

describe("chat template", () => {
  it("exports all required template constants", () => {
    expect(typeof chatSchemaTs).toBe("string")
    expect(typeof chatFunctionsTs).toBe("string")
    expect(typeof chatServerTs).toBe("string")
    expect(typeof chatReadmeMd).toBe("string")
  })

  it("schema defines chat-specific tables", () => {
    expect(chatSchemaTs).toContain("rooms:")
    expect(chatSchemaTs).toContain("messages:")
    expect(chatSchemaTs).toContain("users:")
    expect(chatSchemaTs).toContain("roomMembers:")
  })

  it("schema has proper foreign key references", () => {
    expect(chatSchemaTs).toContain('v.id("rooms")')
    expect(chatSchemaTs).toContain('v.id("users")')
  })

  it("functions define messaging operations", () => {
    expect(chatFunctionsTs).toContain("sendMessage")
    expect(chatFunctionsTs).toContain("editMessage")
    expect(chatFunctionsTs).toContain("deleteMessage")
    expect(chatFunctionsTs).toContain("listMessages")
    expect(chatFunctionsTs).toContain("listRooms")
    expect(chatFunctionsTs).toContain("createRoom")
  })

  it("functions require authentication for mutations", () => {
    expect(chatFunctionsTs).toContain("ctx.auth.requireUser()")
  })

  it("functions support message ordering and limits", () => {
    expect(chatFunctionsTs).toContain("orderBy")
    expect(chatFunctionsTs).toContain("limit")
  })

  it("server setup includes auth providers config", () => {
    expect(chatServerTs).toContain("createReactiveBaseServer")
    expect(chatServerTs).toContain("auth:")
  })

  it("readme describes chat features", () => {
    expect(chatReadmeMd).toContain("# Realtime Chat")
    expect(chatReadmeMd).toContain("messaging")
  })
})

// ─── SaaS Template ──────────────────────────────────────────────────────────

describe("saas template", () => {
  it("exports schema, functions, config, and admin templates", () => {
    expect(typeof saasSchemaTs).toBe("string")
    expect(typeof saasTenantsTs).toBe("string")
    expect(typeof saasProjectsTs).toBe("string")
    expect(typeof saasConfigTs).toBe("string")
    expect(typeof saasEnvExample).toBe("string")
    expect(typeof saasAdminTs).toBe("string")
  })

  it("schema defines multi-tenant tables", () => {
    expect(saasSchemaTs).toContain("tenants:")
    expect(saasSchemaTs).toContain("users:")
    expect(saasSchemaTs).toContain("projects:")
  })

  it("schema has plan enum with billing tiers", () => {
    expect(saasSchemaTs).toContain("free")
    expect(saasSchemaTs).toContain("starter")
    expect(saasSchemaTs).toContain("pro")
    expect(saasSchemaTs).toContain("enterprise")
  })

  it("tenant functions include onboarding and billing", () => {
    expect(saasTenantsTs).toContain("onboardTenant")
    expect(saasTenantsTs).toContain("changePlan")
    expect(saasTenantsTs).toContain("handleBillingWebhook")
  })

  it("config uses defineConfig and jwtProvider", () => {
    expect(saasConfigTs).toContain("defineConfig")
    expect(saasConfigTs).toContain("jwtProvider")
  })

  it("env example includes DATABASE_URL and auth config", () => {
    expect(saasEnvExample).toContain("DATABASE_URL")
    expect(saasEnvExample).toContain("JWT_ISSUER")
  })

  it("admin functions include dashboard and analytics", () => {
    expect(saasAdminTs).toContain("adminDashboard")
    expect(saasAdminTs).toContain("revenueMetrics")
    expect(saasAdminTs).toContain("analyticsReport")
  })
})
