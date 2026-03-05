/**
 * SSRF protection for webhook URLs.
 * Validates URLs to prevent requests to internal/private network ranges.
 */

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local
  /^0\./, // current network
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i, // link-local IPv6
]

const BLOCKED_HOSTNAMES = ["localhost", "localhost.localdomain", "[::1]"]

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WebhookUrlError"
  }
}

/**
 * Validates a webhook URL against SSRF attacks.
 * Rejects private IPs, localhost, link-local addresses, and
 * non-HTTPS URLs in production.
 */
export function validateWebhookUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new WebhookUrlError(`Invalid webhook URL: ${url}`)
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new WebhookUrlError(`Webhook URL must use HTTP or HTTPS: ${url}`)
  }

  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new WebhookUrlError(`Webhook URL must use HTTPS in production: ${url}`)
  }

  const hostname = parsed.hostname.toLowerCase()

  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new WebhookUrlError(`Webhook URL must not target localhost: ${url}`)
  }

  for (const re of PRIVATE_IP_RANGES) {
    if (re.test(hostname)) {
      throw new WebhookUrlError(`Webhook URL must not target private/internal networks: ${url}`)
    }
  }
}
