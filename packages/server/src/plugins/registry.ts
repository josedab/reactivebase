/**
 * Plugin registry client for ReactiveBase.
 * Discovers, validates, and installs community plugins.
 */

import type { PluginManifest } from "./plugins.js"

export interface RegistryEntry extends PluginManifest {
  npmPackage: string
  installCommand: string
  downloads?: number
  verified: boolean
}

/**
 * Built-in plugin registry (seed data).
 */
export const BUILTIN_PLUGINS: RegistryEntry[] = [
  {
    name: "clerk",
    version: "0.1.0",
    description: "Clerk authentication for ReactiveBase — JWT verification and user management",
    author: "ReactiveBase",
    npmPackage: "@reactivebase/plugin-clerk",
    installCommand: "npm install @reactivebase/plugin-clerk",
    keywords: ["auth", "clerk", "jwt", "authentication"],
    verified: true,
  },
  {
    name: "stripe",
    version: "0.1.0",
    description: "Stripe webhook integration — receive payment events and trigger reactive updates",
    author: "ReactiveBase",
    npmPackage: "@reactivebase/plugin-stripe",
    installCommand: "npm install @reactivebase/plugin-stripe",
    keywords: ["payments", "stripe", "webhooks", "billing"],
    verified: true,
  },
  {
    name: "s3-storage",
    version: "0.1.0",
    description: "S3-compatible file storage with reactive URLs — supports AWS S3, R2, MinIO",
    author: "ReactiveBase",
    npmPackage: "@reactivebase/plugin-s3",
    installCommand: "npm install @reactivebase/plugin-s3",
    keywords: ["storage", "s3", "files", "uploads"],
    verified: true,
  },
  {
    name: "resend",
    version: "0.1.0",
    description: "Resend email integration — send transactional emails from actions",
    author: "ReactiveBase",
    npmPackage: "@reactivebase/plugin-resend",
    installCommand: "npm install @reactivebase/plugin-resend",
    keywords: ["email", "resend", "transactional"],
    verified: true,
  },
  {
    name: "posthog",
    version: "0.1.0",
    description: "PostHog analytics — track server-side events and feature flags",
    author: "ReactiveBase",
    npmPackage: "@reactivebase/plugin-posthog",
    installCommand: "npm install @reactivebase/plugin-posthog",
    keywords: ["analytics", "posthog", "tracking", "feature-flags"],
    verified: true,
  },
]

/**
 * Plugin registry client.
 */
export class PluginRegistryClient {
  private registryUrl: string
  private plugins: RegistryEntry[]

  constructor(options: { registryUrl?: string } = {}) {
    this.registryUrl = options.registryUrl ?? "https://registry.reactivebase.dev"
    this.plugins = [...BUILTIN_PLUGINS]
  }

  /**
   * Search for plugins by name or keyword.
   */
  search(query: string): RegistryEntry[] {
    const q = query.toLowerCase()
    return this.plugins.filter(
      (p) => p.name.includes(q) || p.description.toLowerCase().includes(q) || p.keywords?.some((k) => k.includes(q)),
    )
  }

  /**
   * Get a plugin by name.
   */
  get(name: string): RegistryEntry | undefined {
    return this.plugins.find((p) => p.name === name)
  }

  /**
   * List all available plugins.
   */
  list(): RegistryEntry[] {
    return [...this.plugins]
  }

  /**
   * Fetch the latest registry from the remote server.
   */
  async refresh(): Promise<void> {
    try {
      const response = await fetch(`${this.registryUrl}/plugins.json`)
      if (response.ok) {
        const remote = (await response.json()) as { plugins: RegistryEntry[] }
        this.plugins = remote.plugins
      }
    } catch {
      // Fallback to built-in registry
    }
  }

  /**
   * Generate the install command for a plugin.
   */
  getInstallCommand(name: string): string | null {
    const plugin = this.get(name)
    return plugin?.installCommand ?? null
  }

  /**
   * Generate registry JSON for static hosting.
   */
  toJSON(): string {
    return JSON.stringify({ plugins: this.plugins, generatedAt: new Date().toISOString() }, null, 2)
  }
}
