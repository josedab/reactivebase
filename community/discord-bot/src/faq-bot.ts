/**
 * ReactiveBase Discord FAQ Bot.
 * Searches documentation and provides instant answers to common questions.
 *
 * Usage:
 *   const bot = new FaqBot(docsIndex)
 *   const answer = bot.search("how do I define a schema")
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DocsEntry {
  title: string
  path: string
  content: string
  section: string
  keywords: string[]
}

export interface SearchResult {
  entry: DocsEntry
  score: number
  snippet: string
}

export interface BotMetrics {
  questionsAnswered: number
  avgResponseTimeMs: number
  topQueries: Array<{ query: string; count: number }>
  activeMembers: number
}

// ─── FAQ Index ───────────────────────────────────────────────────────────────

const DOCS_INDEX: DocsEntry[] = [
  { title: "Getting Started", path: "/docs/getting-started", section: "quickstart", content: "Install ReactiveBase with npx create-reactivebase my-app. Run npm install and npm run dev.", keywords: ["install", "setup", "start", "create", "npx", "scaffold"] },
  { title: "Schema Definition", path: "/docs/learn/schema-deep-dive", section: "schema", content: "Define schemas with defineSchema and defineTable. Validators: v.string, v.number, v.boolean, v.timestamp, v.id, v.enum, v.json, v.array, v.optional, v.vector, v.custom.", keywords: ["schema", "table", "validator", "type", "define", "column", "field"] },
  { title: "Reactive Queries", path: "/docs/learn/reactive-queries", section: "queries", content: "Every query is live by default. Use query() to define. Clients auto-update when data changes. Three invalidation levels: table, filter, row.", keywords: ["query", "reactive", "live", "subscription", "invalidation", "realtime", "update"] },
  { title: "Mutations", path: "/docs/learn/transactions", section: "mutations", content: "Every mutation runs in a SERIALIZABLE Postgres transaction. Auto-retry on conflicts. Use mutation() to define.", keywords: ["mutation", "transaction", "write", "insert", "update", "delete", "serializable"] },
  { title: "Authentication", path: "/docs/core-concepts#auth", section: "auth", content: "JWT authentication with HS256/RS256/JWKS. Custom providers. RBAC with roles() and allow(). Row-level security policies.", keywords: ["auth", "jwt", "login", "token", "rbac", "role", "permission", "security"] },
  { title: "Deployment", path: "/docs/deployment", section: "deploy", content: "Deploy to Docker, Fly.io, Railway, Render, or Kubernetes. Use reactivebase deploy for one-command deployment.", keywords: ["deploy", "docker", "kubernetes", "fly", "railway", "render", "production", "hosting"] },
  { title: "Comparison: vs Convex", path: "/docs/compare/convex", section: "compare", content: "ReactiveBase provides Convex-like DX on self-hosted Postgres. Key differences: self-hosted, raw SQL, Postgres-native.", keywords: ["convex", "compare", "alternative", "vs", "difference", "migrate"] },
  { title: "Multi-Tenancy", path: "/docs/learn/compliance-guide", section: "enterprise", content: "Row-level or schema-per-tenant isolation. SaaS starter template with billing. Use npx create-reactivebase --template saas.", keywords: ["tenant", "multi-tenant", "saas", "isolation", "billing", "enterprise"] },
  { title: "AI & Vector Search", path: "/docs/api-reference#ai", section: "ai", content: "Built-in pgvector support. v.vector() type with HNSW/IVFFlat indexes. RAG pipeline with OpenAI/Ollama providers.", keywords: ["ai", "vector", "embedding", "search", "rag", "openai", "similarity", "pgvector"] },
  { title: "Plugins", path: "/docs/api-reference#plugins", section: "plugins", content: "Plugin marketplace with 10+ first-party plugins: Clerk, Stripe, Resend, Sentry, Vercel, Auth0, PostHog, OpenAI.", keywords: ["plugin", "marketplace", "clerk", "stripe", "resend", "sentry", "integration"] },
]

// ─── FAQ Bot ─────────────────────────────────────────────────────────────────

export class FaqBot {
  private index: DocsEntry[]
  private queryLog: Array<{ query: string; timestamp: number }> = []
  private answeredCount = 0

  constructor(customDocs?: DocsEntry[]) {
    this.index = [...DOCS_INDEX, ...(customDocs ?? [])]
  }

  search(query: string, limit: number = 3): SearchResult[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const scored: SearchResult[] = []

    for (const entry of this.index) {
      let score = 0
      const searchable = `${entry.title} ${entry.content} ${entry.keywords.join(" ")}`.toLowerCase()

      for (const term of terms) {
        // Keyword match (highest weight)
        if (entry.keywords.some((k) => k.includes(term))) score += 10
        // Title match
        if (entry.title.toLowerCase().includes(term)) score += 5
        // Content match
        if (searchable.includes(term)) score += 2
      }

      if (score > 0) {
        const snippetStart = Math.max(0, entry.content.toLowerCase().indexOf(terms[0]) - 20)
        const snippet = entry.content.substring(snippetStart, snippetStart + 150).trim()
        scored.push({ entry, score, snippet: snippet + (snippet.length >= 150 ? "..." : "") })
      }
    }

    this.queryLog.push({ query, timestamp: Date.now() })
    if (scored.length > 0) this.answeredCount++

    return scored.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  formatResponse(query: string): string {
    const results = this.search(query)

    if (results.length === 0) {
      return `I couldn't find docs for "${query}". Try asking in #help or check https://reactivebase.dev/docs`
    }

    const lines = [`📚 **Results for "${query}":**\n`]
    for (const r of results) {
      lines.push(`**${r.entry.title}** — [Read docs](https://reactivebase.dev${r.entry.path})`)
      lines.push(`> ${r.snippet}\n`)
    }

    return lines.join("\n")
  }

  getMetrics(): BotMetrics {
    const queryCount = new Map<string, number>()
    for (const q of this.queryLog) {
      const key = q.query.toLowerCase().trim()
      queryCount.set(key, (queryCount.get(key) ?? 0) + 1)
    }

    const topQueries = Array.from(queryCount.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      questionsAnswered: this.answeredCount,
      avgResponseTimeMs: 5, // instant for local search
      topQueries,
      activeMembers: 0, // Would be populated from Discord API
    }
  }
}
