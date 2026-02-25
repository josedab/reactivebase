/**
 * Stripe billing integration for ReactiveBase SaaS Kit.
 * Uses raw fetch() calls to the Stripe API (no SDK dependency).
 *
 * Usage:
 *   const stripe = new StripeBillingProvider({ apiKey: "sk_...", webhookSecret: "whsec_..." })
 *   const customerId = await stripe.createCustomer("user@acme.com", "Acme Corp")
 *   const session = await stripe.createCheckoutSession("tenant_1", "pro", "https://app.com/billing")
 */

import { createHmac, timingSafeEqual } from "node:crypto"
import type { SaasBillingProvider } from "./saas-kit.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StripeConfig {
  /** Stripe secret API key (sk_...) */
  apiKey: string
  /** Stripe webhook signing secret (whsec_...) */
  webhookSecret?: string
  /** Stripe API base URL (default: https://api.stripe.com) */
  apiBase?: string
  /** API version header (default: "2024-06-20") */
  apiVersion?: string
}

export interface StripeWebhookEvent {
  id: string
  type: string
  data: {
    object: Record<string, unknown>
  }
  created: number
}

export interface CheckoutSession {
  id: string
  url: string
  tenantId: string
  planId: string
  status: "open" | "complete" | "expired"
}

export interface Invoice {
  id: string
  customerId: string
  amountDue: number
  amountPaid: number
  currency: string
  status: "draft" | "open" | "paid" | "void" | "uncollectible"
  periodStart: number
  periodEnd: number
  pdfUrl: string | null
}

// ─── Stripe Billing Provider ─────────────────────────────────────────────────

const DEFAULT_API_BASE = "https://api.stripe.com"
const DEFAULT_API_VERSION = "2024-06-20"

export class StripeBillingProvider implements SaasBillingProvider {
  private config: Required<StripeConfig>

  constructor(config: StripeConfig) {
    this.config = {
      apiBase: DEFAULT_API_BASE,
      apiVersion: DEFAULT_API_VERSION,
      webhookSecret: "",
      ...config,
    }
  }

  // ─── SaasBillingProvider Interface ──────────────────────────────────────

  async createCustomer(email: string, name: string): Promise<string> {
    const res = await this.stripeRequest("POST", "/v1/customers", {
      email,
      name,
    })
    return res.id as string
  }

  async createSubscription(customerId: string, planId: string): Promise<string> {
    const res = await this.stripeRequest("POST", "/v1/subscriptions", {
      customer: customerId,
      "items[0][price]": planId,
    })
    return res.id as string
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripeRequest("DELETE", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`)
  }

  async getUsage(customerId: string): Promise<Record<string, number>> {
    const res = await this.stripeRequest(
      "GET",
      `/v1/subscription_items?customer=${encodeURIComponent(customerId)}&expand[]=data.usage`,
    )
    const usage: Record<string, number> = {}
    const items = (res.data ?? []) as Array<Record<string, unknown>>
    for (const item of items) {
      const price = item.price as Record<string, unknown> | undefined
      const meterId = (price?.id as string) ?? (item.id as string)
      usage[meterId] = (item.quantity as number) ?? 0
    }
    return usage
  }

  // ─── Extended Methods ──────────────────────────────────────────────────

  async recordUsage(subscriptionItemId: string, metric: string, quantity: number): Promise<void> {
    await this.stripeRequest("POST", "/v1/usage_records", {
      subscription_item: subscriptionItemId,
      quantity: String(quantity),
      action: "increment",
      timestamp: String(Math.floor(Date.now() / 1000)),
    })
  }

  async createCheckoutSession(tenantId: string, planId: string, returnUrl: string): Promise<CheckoutSession> {
    const res = await this.stripeRequest("POST", "/v1/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": planId,
      "line_items[0][quantity]": "1",
      success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: returnUrl,
      "metadata[tenant_id]": tenantId,
    })

    return {
      id: res.id as string,
      url: res.url as string,
      tenantId,
      planId,
      status: (res.status as CheckoutSession["status"]) ?? "open",
    }
  }

  async handleWebhook(payload: string, signature: string): Promise<{ event: StripeWebhookEvent; action: string }> {
    // Verify signature if webhook secret is configured
    if (this.config.webhookSecret) {
      this.verifyWebhookSignature(payload, signature, this.config.webhookSecret)
    }

    const event = JSON.parse(payload) as StripeWebhookEvent
    let action = "ignored"

    switch (event.type) {
      case "customer.subscription.created":
        action = "subscription_created"
        break
      case "customer.subscription.updated":
        action = "subscription_updated"
        break
      case "customer.subscription.deleted":
        action = "subscription_cancelled"
        break
      case "invoice.paid":
        action = "invoice_paid"
        break
      case "invoice.payment_failed":
        action = "payment_failed"
        break
    }

    return { event, action }
  }

  async getInvoices(customerId: string): Promise<Invoice[]> {
    const res = await this.stripeRequest("GET", `/v1/invoices?customer=${encodeURIComponent(customerId)}&limit=100`)
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

  private verifyWebhookSignature(payload: string, signature: string, secret: string): void {
    // Parse the Stripe-Signature header
    const parts = signature.split(",").reduce(
      (acc, part) => {
        const [key, value] = part.split("=")
        if (key && value) acc[key.trim()] = value.trim()
        return acc
      },
      {} as Record<string, string>,
    )

    if (!parts.t || !parts.v1) {
      throw new Error("Invalid Stripe webhook signature format")
    }

    const expectedSig = createHmac("sha256", secret).update(`${parts.t}.${payload}`).digest("hex")

    const expectedBuf = Buffer.from(expectedSig, "hex")
    const actualBuf = Buffer.from(parts.v1, "hex")
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      throw new Error("Invalid Stripe webhook signature")
    }
  }
}
