import { describe, it, expect } from "vitest"
import {
  WebhookRegistry,
  OutboundWebhookManager,
  defineWebhook,
  parseNotifyPayload,
  generateNotifyTriggerSQL,
} from "../webhooks/webhooks.js"
import { createHmac } from "node:crypto"
import type { IncomingMessage } from "node:http"

function createMockRequest(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

describe("WebhookRegistry", () => {
  it("registers and retrieves webhooks", () => {
    const registry = new WebhookRegistry()
    registry.register(defineWebhook("stripe", {
      handler: async () => ({ invalidateTables: ["payments"] }),
    }))

    expect(registry.get("stripe")).toBeDefined()
    expect(registry.size).toBe(1)
  })

  it("handles inbound webhook without signature", async () => {
    const registry = new WebhookRegistry()
    const received: unknown[] = []

    registry.register(defineWebhook("test", {
      handler: async (payload) => {
        received.push(payload)
        return { invalidateTables: ["tasks"] }
      },
    }))

    const body = Buffer.from(JSON.stringify({ action: "created" }))
    const result = await registry.handleRequest("test", createMockRequest(), body)

    expect(result.status).toBe(200)
    expect(result.result?.invalidateTables).toEqual(["tasks"])
    expect(received).toHaveLength(1)
  })

  it("verifies HMAC signature", async () => {
    const secret = "webhook-secret-123"
    const registry = new WebhookRegistry()

    registry.register(defineWebhook("secure", {
      secret,
      signatureHeader: "X-Signature",
      handler: async () => ({}),
    }))

    const body = Buffer.from('{"event":"test"}')
    const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex")

    const result = await registry.handleRequest(
      "secure",
      createMockRequest({ "x-signature": signature }),
      body,
    )
    expect(result.status).toBe(200)
  })

  it("rejects invalid signature", async () => {
    const registry = new WebhookRegistry()
    registry.register(defineWebhook("secure", {
      secret: "correct-secret",
      signatureHeader: "X-Signature",
      handler: async () => ({}),
    }))

    const body = Buffer.from('{"event":"test"}')
    const badSig = "sha256=" + createHmac("sha256", "wrong-secret").update(body).digest("hex")

    const result = await registry.handleRequest(
      "secure",
      createMockRequest({ "x-signature": badSig }),
      body,
    )
    expect(result.status).toBe(401)
  })

  it("returns 404 for unknown webhook", async () => {
    const registry = new WebhookRegistry()
    const result = await registry.handleRequest("unknown", createMockRequest(), Buffer.from("{}"))
    expect(result.status).toBe(404)
  })
})

describe("OutboundWebhookManager", () => {
  it("registers outbound hooks", () => {
    const manager = new OutboundWebhookManager()
    manager.register({
      url: "https://example.com/hook",
      onMutations: ["tasks.create"],
    })
    expect(manager.size).toBe(1)
  })

  it("matches hooks by mutation name", () => {
    const manager = new OutboundWebhookManager()
    manager.register({ url: "https://a.com", onMutations: ["tasks.create"] })
    manager.register({ url: "https://b.com", onMutations: ["users.update"] })
    manager.register({ url: "https://c.com", onMutations: ["*"] })

    const hooks = manager.getHooksForMutation("tasks.create")
    expect(hooks).toHaveLength(2) // tasks.create + wildcard
  })
})

describe("parseNotifyPayload", () => {
  it("parses valid JSON notification", () => {
    const event = parseNotifyPayload(JSON.stringify({
      table: "tasks",
      operation: "INSERT",
      id: "123",
      row: { id: "123", title: "New task" },
    }))

    expect(event).not.toBeNull()
    expect(event!.table).toBe("tasks")
    expect(event!.operation).toBe("INSERT")
    expect(event!.affectedFilters).toEqual({ id: "123", title: "New task" })
  })

  it("returns null for invalid payload", () => {
    expect(parseNotifyPayload("not json")).toBeNull()
    expect(parseNotifyPayload('{"foo":"bar"}')).toBeNull()
  })
})

describe("generateNotifyTriggerSQL", () => {
  it("generates valid trigger SQL", () => {
    const sql = generateNotifyTriggerSQL("tasks")

    expect(sql).toContain("CREATE OR REPLACE FUNCTION notify_tasks_changes()")
    expect(sql).toContain("pg_notify")
    expect(sql).toContain("AFTER INSERT OR UPDATE OR DELETE")
    expect(sql).toContain("ON \"tasks\"")
  })

  it("uses custom channel name", () => {
    const sql = generateNotifyTriggerSQL("tasks", "my_channel")
    expect(sql).toContain("'my_channel'")
  })
})
