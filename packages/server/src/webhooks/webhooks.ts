/**
 * Webhook system for ReactiveBase.
 * Supports inbound webhooks (receive events from external services),
 * outbound webhooks (send events on mutations), and
 * Postgres LISTEN/NOTIFY for external change detection.
 */

import { createHmac, timingSafeEqual } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { ChangeEvent } from "../reactivity/index.js"

// --- Inbound Webhooks ---

export interface WebhookDefinition {
  /** Unique name for routing (e.g., "stripe", "github") */
  name: string
  /** Secret for HMAC signature verification */
  secret?: string
  /** Header name containing the signature */
  signatureHeader?: string
  /** Hash algorithm for signature (default: sha256) */
  signatureAlgorithm?: string
  /** Handler function called when webhook is received */
  handler: (payload: unknown, headers: Record<string, string>) => Promise<WebhookResult>
}

export interface WebhookResult {
  /** Tables that may have been affected, triggering reactive invalidation */
  invalidateTables?: string[]
  /** Specific change events for filter-level invalidation */
  changeEvents?: ChangeEvent[]
}

export class WebhookRegistry {
  private webhooks = new Map<string, WebhookDefinition>()

  /**
   * Register a webhook handler.
   */
  register(definition: WebhookDefinition): void {
    this.webhooks.set(definition.name, definition)
  }

  /**
   * Get a registered webhook by name.
   */
  get(name: string): WebhookDefinition | undefined {
    return this.webhooks.get(name)
  }

  /**
   * Handle an incoming webhook HTTP request.
   * Route: POST /webhooks/:name
   */
  async handleRequest(
    name: string,
    req: IncomingMessage,
    body: Buffer,
  ): Promise<{ status: number; result?: WebhookResult; error?: string }> {
    const webhook = this.webhooks.get(name)
    if (!webhook) {
      return { status: 404, error: `Webhook "${name}" not found` }
    }

    // Verify signature if configured
    if (webhook.secret && webhook.signatureHeader) {
      const signature = req.headers[webhook.signatureHeader.toLowerCase()] as string
      if (!signature) {
        return { status: 401, error: "Missing webhook signature" }
      }

      const isValid = verifyWebhookSignature(body, signature, webhook.secret, webhook.signatureAlgorithm ?? "sha256")

      if (!isValid) {
        return { status: 401, error: "Invalid webhook signature" }
      }
    }

    try {
      const payload = JSON.parse(body.toString("utf-8"))
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers[key] = value
      }

      const result = await webhook.handler(payload, headers)
      return { status: 200, result }
    } catch (error) {
      return {
        status: 500,
        error: error instanceof Error ? error.message : "Webhook handler error",
      }
    }
  }

  get size(): number {
    return this.webhooks.size
  }
}

// --- Outbound Webhooks ---

export interface OutboundWebhook {
  /** URL to POST to */
  url: string
  /** Optional secret for signing the payload */
  secret?: string
  /** Function names to trigger on (e.g., ["tasks.create"]) */
  onMutations: string[]
  /** Custom headers */
  headers?: Record<string, string>
}

export class OutboundWebhookManager {
  private hooks: OutboundWebhook[] = []

  register(hook: OutboundWebhook): void {
    this.hooks.push(hook)
  }

  /**
   * Get all outbound hooks that should fire for a given mutation.
   */
  getHooksForMutation(mutationName: string): OutboundWebhook[] {
    return this.hooks.filter((h) => h.onMutations.includes(mutationName) || h.onMutations.includes("*"))
  }

  /**
   * Send outbound webhook notifications for a mutation.
   */
  async notify(mutationName: string, result: unknown, modifiedTables: string[]): Promise<void> {
    const hooks = this.getHooksForMutation(mutationName)

    await Promise.allSettled(
      hooks.map((hook) =>
        this.send(hook, {
          event: mutationName,
          data: result,
          modifiedTables,
          timestamp: new Date().toISOString(),
        }),
      ),
    )
  }

  private async send(hook: OutboundWebhook, payload: unknown): Promise<void> {
    const body = JSON.stringify(payload)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...hook.headers,
    }

    if (hook.secret) {
      const signature = createHmac("sha256", hook.secret).update(body).digest("hex")
      headers["X-ReactiveBase-Signature"] = `sha256=${signature}`
    }

    const response = await fetch(hook.url, {
      method: "POST",
      headers,
      body,
    })

    if (!response.ok) {
      console.error(`Outbound webhook to ${hook.url} failed: ${response.status}`)
    }
  }

  get size(): number {
    return this.hooks.length
  }
}

// --- Postgres LISTEN/NOTIFY ---

export interface NotifyListenerOptions {
  /** Channel name to listen on */
  channel: string
  /** Handler called when a notification is received */
  handler: (payload: string) => ChangeEvent[]
}

/**
 * Parse a Postgres NOTIFY payload into change events.
 * Expected format: JSON with { table, operation, id? }
 */
export function parseNotifyPayload(payload: string): ChangeEvent | null {
  try {
    const data = JSON.parse(payload) as {
      table?: string
      operation?: string
      id?: string
      row?: Record<string, unknown>
    }

    if (!data.table || !data.operation) return null

    return {
      table: data.table,
      operation: data.operation as ChangeEvent["operation"],
      affectedFilters: data.row,
    }
  } catch {
    return null
  }
}

/**
 * Generate SQL for a Postgres trigger that sends NOTIFY on table changes.
 */
export function generateNotifyTriggerSQL(tableName: string, channel: string = "reactivebase_changes"): string {
  const functionName = `notify_${tableName}_changes`

  return `
CREATE OR REPLACE FUNCTION ${functionName}()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('${channel}', json_build_object(
    'table', '${tableName}',
    'operation', TG_OP,
    'id', COALESCE(NEW.id, OLD.id),
    'row', CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD) ELSE row_to_json(NEW) END
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ${functionName}_trigger ON "${tableName}";
CREATE TRIGGER ${functionName}_trigger
  AFTER INSERT OR UPDATE OR DELETE ON "${tableName}"
  FOR EACH ROW EXECUTE FUNCTION ${functionName}();
`
}

// --- Helpers ---

function verifyWebhookSignature(body: Buffer, signature: string, secret: string, algorithm: string): boolean {
  // Handle signatures with prefix like "sha256=..."
  const parts = signature.split("=")
  const sigHex = parts.length > 1 ? parts.slice(1).join("=") : signature

  const expected = createHmac(algorithm, secret).update(body).digest("hex")

  try {
    return timingSafeEqual(Buffer.from(sigHex, "hex"), Buffer.from(expected, "hex"))
  } catch {
    return false
  }
}

/**
 * Define an inbound webhook.
 */
export function defineWebhook(name: string, config: Omit<WebhookDefinition, "name">): WebhookDefinition {
  return { name, ...config }
}
