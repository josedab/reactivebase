// --------------------------------------------------------------------------
// Edge-Native Query Execution — Runtime Adapters
// Bloom-filter invalidation, platform adapters, and smart routing
// --------------------------------------------------------------------------

import { EdgeQueryError } from "./edge-query.js"

// ── Types ──────────────────────────────────────────────────────────────────

export interface BloomFilterOptions {
  expectedElements: number
  falsePositiveRate: number
}

export type EdgeRuntimeType = "cloudflare" | "vercel" | "deno"

export interface CloudflareConfig {
  accountId: string
  kvNamespaceId: string
  durableObjectNamespace?: string
  workerName: string
  routes?: string[]
}

export interface VercelEdgeConfig {
  projectId: string
  teamId?: string
  edgeConfigId?: string
  kvStoreId?: string
}

export interface DenoDeployConfig {
  projectName: string
  organizationId?: string
  kvDatabaseId?: string
}

export interface SmartRouterOptions {
  regions: string[]
  defaultTtl: number
  healthCheckIntervalMs?: number
  maxLatencyMs?: number
  failoverThreshold?: number
}

export interface LatencyRecord {
  region: string
  latencyMs: number
  timestamp: number
  healthy: boolean
}

export interface RoutingDecision {
  region: string
  ttl: number
  invalidationOverride: boolean
  fallbackRegion?: string
}

// ── Bloom Filter Invalidation ──────────────────────────────────────────────

export class BloomFilterInvalidation {
  private readonly bits: Uint8Array
  private readonly numHashes: number
  private readonly size: number
  private count = 0

  constructor(private readonly options: BloomFilterOptions) {
    if (options.expectedElements <= 0) {
      throw new EdgeQueryError("expectedElements must be positive", "INVALID_CONFIG")
    }
    if (options.falsePositiveRate <= 0 || options.falsePositiveRate >= 1) {
      throw new EdgeQueryError("falsePositiveRate must be between 0 and 1", "INVALID_CONFIG")
    }

    // Optimal size: m = -n * ln(p) / (ln(2)^2)
    this.size = Math.ceil((-options.expectedElements * Math.log(options.falsePositiveRate)) / (Math.LN2 * Math.LN2))
    // Optimal number of hashes: k = (m/n) * ln(2)
    this.numHashes = Math.max(1, Math.round((this.size / options.expectedElements) * Math.LN2))
    this.bits = new Uint8Array(Math.ceil(this.size / 8))
  }

  addTable(tableName: string): void {
    const hashes = this.getHashes(tableName)
    for (const h of hashes) {
      const index = h % this.size
      this.bits[Math.floor(index / 8)] |= 1 << (index % 8)
    }
    this.count++
  }

  mightContain(tableName: string): boolean {
    const hashes = this.getHashes(tableName)
    for (const h of hashes) {
      const index = h % this.size
      if ((this.bits[Math.floor(index / 8)] & (1 << (index % 8))) === 0) {
        return false
      }
    }
    return true
  }

  serialize(): Uint8Array {
    // Header: 4 bytes size (uint32) + 4 bytes numHashes (uint32) + filter bits
    const header = new Uint8Array(8)
    const view = new DataView(header.buffer)
    view.setUint32(0, this.size)
    view.setUint32(4, this.numHashes)
    const result = new Uint8Array(header.length + this.bits.length)
    result.set(header)
    result.set(this.bits, header.length)
    return result
  }

  static deserialize(data: Uint8Array): BloomFilterInvalidation {
    if (data.length < 8) {
      throw new EdgeQueryError("Invalid bloom filter data", "INVALID_CONFIG")
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const size = view.getUint32(0)
    const numHashes = view.getUint32(4)
    const bits = data.slice(8)

    // Reconstruct with placeholder options; override internals
    const filter = Object.create(BloomFilterInvalidation.prototype) as BloomFilterInvalidation
    Object.assign(filter, {
      options: { expectedElements: size, falsePositiveRate: 0.01 },
      size,
      numHashes,
      bits,
      count: 0,
    })
    return filter
  }

  get elementCount(): number {
    return this.count
  }

  get bitSize(): number {
    return this.size
  }

  // Simple hash functions using FNV-1a variants
  private getHashes(value: string): number[] {
    let h1 = 0x811c9dc5 // FNV offset basis
    let h2 = 0x01000193 // FNV prime seed
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i)
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
      h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0
    }
    const hashes: number[] = []
    for (let i = 0; i < this.numHashes; i++) {
      hashes.push(((h1 + Math.imul(i, h2)) >>> 0) % this.size)
    }
    return hashes
  }
}

// ── Cloudflare Worker Adapter ──────────────────────────────────────────────

export class CloudflareWorkerAdapter {
  private readonly cache = new Map<string, { value: string; expiresAt: number }>()

  constructor(private readonly config: CloudflareConfig) {
    if (!config.accountId || !config.kvNamespaceId || !config.workerName) {
      throw new EdgeQueryError("accountId, kvNamespaceId, and workerName are required", "INVALID_CONFIG")
    }
  }

  async cacheGet(key: string): Promise<string | null> {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.value
  }

  async cacheSet(key: string, value: string, ttl: number): Promise<void> {
    this.cache.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
  }

  async durableObjectGet(id: string): Promise<{ id: string; namespace: string }> {
    const namespace = this.config.durableObjectNamespace || this.config.workerName
    return { id, namespace }
  }

  async invalidate(tables: string[]): Promise<void> {
    for (const [key, entry] of this.cache) {
      try {
        const parsed = JSON.parse(entry.value)
        if (parsed?.dependencies && Array.isArray(parsed.dependencies)) {
          if (tables.some((t) => parsed.dependencies.includes(t))) {
            this.cache.delete(key)
          }
        }
      } catch {
        // Non-JSON values are not table-dependent
      }
    }
  }

  createWorkerScript(): string {
    return `// Auto-generated Cloudflare Worker for ReactiveBase Edge Queries
// Account: ${this.config.accountId}
// KV Namespace: ${this.config.kvNamespaceId}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/query") {
      const body = await request.json();
      const cacheKey = body.queryHash;

      // Check KV cache
      const cached = await env.EDGE_CACHE.get(cacheKey, { type: "json" });
      if (cached) {
        return Response.json({ result: cached.result, fromCache: true });
      }

      // Forward to origin
      const origin = await fetch(env.ORIGIN_URL + "/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await origin.json();

      // Cache in KV
      ctx.waitUntil(
        env.EDGE_CACHE.put(cacheKey, JSON.stringify(result), {
          expirationTtl: body.ttl || 60,
        })
      );

      return Response.json({ result: result.result, fromCache: false });
    }

    if (url.pathname === "/invalidate") {
      const { tables } = await request.json();
      // List and delete matching keys
      const list = await env.EDGE_CACHE.list();
      for (const key of list.keys) {
        const val = await env.EDGE_CACHE.get(key.name, { type: "json" });
        if (val?.dependencies?.some(d => tables.includes(d))) {
          ctx.waitUntil(env.EDGE_CACHE.delete(key.name));
        }
      }
      return Response.json({ invalidated: tables });
    }

    return new Response("Not Found", { status: 404 });
  },
};
`
  }
}

// ── Vercel Edge Adapter ────────────────────────────────────────────────────

export class VercelEdgeAdapter {
  private readonly cache = new Map<string, { value: string; expiresAt: number }>()

  constructor(private readonly config: VercelEdgeConfig) {
    if (!config.projectId) {
      throw new EdgeQueryError("projectId is required", "INVALID_CONFIG")
    }
  }

  async cacheGet(key: string): Promise<string | null> {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.value
  }

  async cacheSet(key: string, value: string, ttl: number): Promise<void> {
    this.cache.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
  }

  async invalidate(tables: string[]): Promise<void> {
    for (const [key, entry] of this.cache) {
      try {
        const parsed = JSON.parse(entry.value)
        if (parsed?.dependencies && Array.isArray(parsed.dependencies)) {
          if (tables.some((t) => parsed.dependencies.includes(t))) {
            this.cache.delete(key)
          }
        }
      } catch {
        // Non-JSON values are not table-dependent
      }
    }
  }

  createEdgeFunction(): string {
    return `// Auto-generated Vercel Edge Function for ReactiveBase Edge Queries
// Project: ${this.config.projectId}

import { NextResponse } from "next/server";

export const config = { runtime: "edge" };

export default async function handler(request) {
  const url = new URL(request.url);

  if (url.pathname === "/api/edge-query" && request.method === "POST") {
    const body = await request.json();
    const cacheKey = \`rb:\${body.queryHash}\`;

    // Check Vercel KV cache
    const cached = await fetch(
      \`\${process.env.KV_REST_API_URL}/get/\${cacheKey}\`,
      { headers: { Authorization: \`Bearer \${process.env.KV_REST_API_TOKEN}\` } }
    );
    const cachedData = await cached.json();
    if (cachedData.result) {
      return NextResponse.json({ result: JSON.parse(cachedData.result), fromCache: true });
    }

    // Forward to origin
    const origin = await fetch(process.env.ORIGIN_URL + "/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await origin.json();

    // Cache in KV with TTL
    await fetch(\`\${process.env.KV_REST_API_URL}/set/\${cacheKey}/\${JSON.stringify(result)}/EX/\${body.ttl || 60}\`, {
      headers: { Authorization: \`Bearer \${process.env.KV_REST_API_TOKEN}\` },
    });

    return NextResponse.json({ result: result.result, fromCache: false });
  }

  return new Response("Not Found", { status: 404 });
}
`
  }
}

// ── Deno Deploy Adapter ────────────────────────────────────────────────────

export class DenoDeployAdapter {
  private readonly cache = new Map<string, { value: string; expiresAt: number }>()

  constructor(private readonly config: DenoDeployConfig) {
    if (!config.projectName) {
      throw new EdgeQueryError("projectName is required", "INVALID_CONFIG")
    }
  }

  async cacheGet(key: string): Promise<string | null> {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.value
  }

  async cacheSet(key: string, value: string, ttl: number): Promise<void> {
    this.cache.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
  }

  async invalidate(tables: string[]): Promise<void> {
    for (const [key, entry] of this.cache) {
      try {
        const parsed = JSON.parse(entry.value)
        if (parsed?.dependencies && Array.isArray(parsed.dependencies)) {
          if (tables.some((t) => parsed.dependencies.includes(t))) {
            this.cache.delete(key)
          }
        }
      } catch {
        // Non-JSON values are not table-dependent
      }
    }
  }

  createDenoModule(): string {
    return `// Auto-generated Deno Deploy module for ReactiveBase Edge Queries
// Project: ${this.config.projectName}

const kv = await Deno.openKv();
const bc = new BroadcastChannel("rb-invalidation");

bc.onmessage = async (event) => {
  const { tables } = event.data;
  const entries = kv.list({ prefix: ["rb-cache"] });
  for await (const entry of entries) {
    if (entry.value?.dependencies?.some((d: string) => tables.includes(d))) {
      await kv.delete(entry.key);
    }
  }
};

Deno.serve(async (request) => {
  const url = new URL(request.url);

  if (url.pathname === "/query" && request.method === "POST") {
    const body = await request.json();
    const cacheKey = ["rb-cache", body.queryHash];

    // Check Deno KV cache
    const cached = await kv.get(cacheKey);
    if (cached.value) {
      return Response.json({ result: cached.value.result, fromCache: true });
    }

    // Forward to origin
    const origin = await fetch(Deno.env.get("ORIGIN_URL") + "/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await origin.json();

    // Cache in Deno KV with TTL
    await kv.set(cacheKey, result, { expireIn: (body.ttl || 60) * 1000 });

    return Response.json({ result: result.result, fromCache: false });
  }

  if (url.pathname === "/invalidate" && request.method === "POST") {
    const { tables } = await request.json();
    bc.postMessage({ tables });
    return Response.json({ invalidated: tables });
  }

  return new Response("Not Found", { status: 404 });
});
`
  }
}

// ── Smart Router ───────────────────────────────────────────────────────────

export class SmartRouter {
  private readonly latencyRecords = new Map<string, LatencyRecord[]>()
  private readonly healthStatus = new Map<string, boolean>()
  private readonly maxLatencyMs: number
  private readonly failoverThreshold: number

  constructor(private readonly options: SmartRouterOptions) {
    if (!options.regions || options.regions.length === 0) {
      throw new EdgeQueryError("At least one region is required", "INVALID_CONFIG")
    }

    this.maxLatencyMs = options.maxLatencyMs ?? 500
    this.failoverThreshold = options.failoverThreshold ?? 3

    for (const region of options.regions) {
      this.healthStatus.set(region, true)
      this.latencyRecords.set(region, [])
    }
  }

  selectRegion(_clientLocation: { latitude: number; longitude: number }): string {
    // Find nearest healthy region by average latency, falling back to first healthy
    let bestRegion: string | null = null
    let bestLatency = Infinity

    for (const region of this.options.regions) {
      if (!this.healthStatus.get(region)) continue
      const avgLatency = this.getAverageLatency(region)
      if (avgLatency < bestLatency) {
        bestLatency = avgLatency
        bestRegion = region
      }
    }

    if (!bestRegion) {
      // All regions unhealthy — return first region as last resort
      throw new EdgeQueryError("No healthy regions available", "NO_REGION")
    }

    return bestRegion
  }

  recordLatency(region: string, latencyMs: number): void {
    const records = this.latencyRecords.get(region)
    if (!records) {
      throw new EdgeQueryError(`Unknown region: ${region}`, "INVALID_CONFIG")
    }

    const record: LatencyRecord = {
      region,
      latencyMs,
      timestamp: Date.now(),
      healthy: latencyMs < this.maxLatencyMs,
    }

    records.push(record)
    // Keep only last 100 records per region
    if (records.length > 100) {
      records.splice(0, records.length - 100)
    }

    // Update health status based on recent failures
    this.updateHealthStatus(region)
  }

  getRoutingDecision(
    query: { hash: string; tables: string[] },
    context: { latitude: number; longitude: number },
  ): RoutingDecision {
    const region = this.selectRegion(context)
    const fallback = this.getFallbackRegion(region)
    const avgLatency = this.getAverageLatency(region)

    // Override TTL if latency is high (reactive invalidation override)
    const invalidationOverride = avgLatency > this.maxLatencyMs * 0.8
    const ttl = invalidationOverride ? Math.max(1, Math.floor(this.options.defaultTtl / 2)) : this.options.defaultTtl

    return {
      region,
      ttl,
      invalidationOverride,
      fallbackRegion: fallback ?? undefined,
    }
  }

  getRegionHealth(): Map<string, boolean> {
    return new Map(this.healthStatus)
  }

  private getAverageLatency(region: string): number {
    const records = this.latencyRecords.get(region)
    if (!records || records.length === 0) return 0
    // Use only records from last 60 seconds
    const cutoff = Date.now() - 60_000
    const recent = records.filter((r) => r.timestamp > cutoff)
    if (recent.length === 0) return 0
    return recent.reduce((sum, r) => sum + r.latencyMs, 0) / recent.length
  }

  private updateHealthStatus(region: string): void {
    const records = this.latencyRecords.get(region)
    if (!records || records.length === 0) return

    // Check last N records for consecutive failures
    const tail = records.slice(-this.failoverThreshold)
    const allUnhealthy = tail.length >= this.failoverThreshold && tail.every((r) => !r.healthy)
    this.healthStatus.set(region, !allUnhealthy)
  }

  private getFallbackRegion(primaryRegion: string): string | null {
    let bestRegion: string | null = null
    let bestLatency = Infinity

    for (const region of this.options.regions) {
      if (region === primaryRegion) continue
      if (!this.healthStatus.get(region)) continue
      const avgLatency = this.getAverageLatency(region)
      if (avgLatency < bestLatency) {
        bestLatency = avgLatency
        bestRegion = region
      }
    }

    return bestRegion
  }
}
