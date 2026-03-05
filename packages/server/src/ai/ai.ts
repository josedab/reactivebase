/**
 * AI provider abstraction for ReactiveBase.
 * Provides embedding and text generation via pluggable providers.
 * No hard dependency on any AI SDK.
 */

export interface AiProvider {
  readonly name: string
  /** Generate embeddings for one or more texts */
  embed(texts: string[], options?: EmbedOptions): Promise<number[][]>
  /** Generate text from a prompt */
  generate?(prompt: string, options?: GenerateOptions): Promise<GenerateResult>
}

export interface EmbedOptions {
  model?: string
  dimensions?: number
}

export interface GenerateOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
}

export interface GenerateResult {
  text: string
  usage?: { promptTokens: number; completionTokens: number }
}

/**
 * OpenAI-compatible provider adapter.
 * Works with OpenAI, Azure OpenAI, and any compatible API.
 */
export function openaiProvider(options: {
  apiKey: string
  baseUrl?: string
  embeddingModel?: string
  chatModel?: string
}): AiProvider {
  const baseUrl = options.baseUrl ?? "https://api.openai.com/v1"
  const embeddingModel = options.embeddingModel ?? "text-embedding-3-small"
  const chatModel = options.chatModel ?? "gpt-4o-mini"

  return {
    name: "openai",

    async embed(texts, embedOpts) {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: embedOpts?.model ?? embeddingModel,
          input: texts,
          ...(embedOpts?.dimensions ? { dimensions: embedOpts.dimensions } : {}),
        }),
      })

      if (!response.ok) {
        throw new Error(`OpenAI embed failed: ${response.status} ${await response.text()}`)
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>
      }
      return data.data.map((d) => d.embedding)
    },

    async generate(prompt, genOpts) {
      const messages = []
      if (genOpts?.systemPrompt) {
        messages.push({ role: "system", content: genOpts.systemPrompt })
      }
      messages.push({ role: "user", content: prompt })

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: genOpts?.model ?? chatModel,
          messages,
          max_tokens: genOpts?.maxTokens,
          temperature: genOpts?.temperature,
        }),
      })

      if (!response.ok) {
        throw new Error(`OpenAI generate failed: ${response.status}`)
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>
        usage?: { prompt_tokens: number; completion_tokens: number }
      }

      return {
        text: data.choices[0].message.content,
        usage: data.usage
          ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
          : undefined,
      }
    },
  }
}

/**
 * Ollama-compatible provider for local models.
 */
export function ollamaProvider(
  options: {
    baseUrl?: string
    embeddingModel?: string
    chatModel?: string
  } = {},
): AiProvider {
  const baseUrl = options.baseUrl ?? "http://localhost:11434"
  const embeddingModel = options.embeddingModel ?? "nomic-embed-text"
  const chatModel = options.chatModel ?? "llama3"

  return {
    name: "ollama",

    async embed(texts, embedOpts) {
      const results: number[][] = []
      for (const text of texts) {
        const response = await fetch(`${baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: embedOpts?.model ?? embeddingModel, prompt: text }),
        })

        if (!response.ok) throw new Error(`Ollama embed failed: ${response.status}`)
        const data = (await response.json()) as { embedding: number[] }
        results.push(data.embedding)
      }
      return results
    },

    async generate(prompt, genOpts) {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: genOpts?.model ?? chatModel,
          prompt,
          system: genOpts?.systemPrompt,
          stream: false,
        }),
      })

      if (!response.ok) throw new Error(`Ollama generate failed: ${response.status}`)
      const data = (await response.json()) as { response: string }
      return { text: data.response }
    },
  }
}

/**
 * Mock provider for testing.
 */
export function mockAiProvider(
  options: {
    embeddingDimensions?: number
    generateResponse?: string
  } = {},
): AiProvider {
  const dims = options.embeddingDimensions ?? 3

  return {
    name: "mock",

    async embed(texts) {
      return texts.map((text) => {
        // Generate deterministic pseudo-embeddings from text hash
        const embedding = new Array(dims)
        for (let i = 0; i < dims; i++) {
          embedding[i] = (text.charCodeAt(i % text.length) / 255) * 2 - 1
        }
        return embedding
      })
    },

    async generate(_prompt) {
      return { text: options.generateResponse ?? "Mock AI response" }
    },
  }
}

/**
 * AI context for use in server functions.
 */
export interface AiContext {
  /** Embed text into a vector */
  embed(text: string, options?: EmbedOptions): Promise<number[]>
  /** Embed multiple texts into vectors */
  embedBatch(texts: string[], options?: EmbedOptions): Promise<number[][]>
  /** Generate text from a prompt */
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>
  /** Search for similar content using vector similarity */
  search(query: string, options: SearchOptions): Promise<SearchResult[]>
}

export interface SearchOptions {
  table: string
  vectorColumn: string
  contentColumn?: string
  topK?: number
  metric?: "cosine" | "l2" | "inner_product"
  filter?: Record<string, unknown>
}

export interface SearchResult {
  id: string
  content?: string
  score: number
  row: Record<string, unknown>
}

/**
 * Create an AI context from a provider.
 */
export function createAiContext(
  provider: AiProvider,
  queryFn?: (sql: string, params: unknown[]) => Promise<unknown[]>,
): AiContext {
  return {
    async embed(text, options) {
      const [embedding] = await provider.embed([text], options)
      return embedding
    },

    async embedBatch(texts, options) {
      return provider.embed(texts, options)
    },

    async generate(prompt, options) {
      if (!provider.generate) throw new Error(`Provider "${provider.name}" does not support generation`)
      return provider.generate(prompt, options)
    },

    async search(query, options) {
      if (!queryFn) throw new Error("Search requires a database query function")

      const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
      const escapeIdent = (name: string): string => name.replace(/"/g, '""')

      if (!SAFE_IDENTIFIER_RE.test(options.table)) {
        throw new Error(`Invalid table name: ${options.table}`)
      }
      if (!SAFE_IDENTIFIER_RE.test(options.vectorColumn)) {
        throw new Error(`Invalid vector column name: ${options.vectorColumn}`)
      }

      const [embedding] = await provider.embed([query])
      const topK = options.topK ?? 10

      const distanceOp: Record<string, string> = {
        cosine: "<=>",
        l2: "<->",
        inner_product: "<#>",
      }
      const op = distanceOp[options.metric ?? "cosine"]

      let sql = `SELECT *, "${escapeIdent(options.vectorColumn)}" ${op} $1 as _distance FROM "${escapeIdent(options.table)}"`
      const params: unknown[] = [`[${embedding.join(",")}]`]

      if (options.filter) {
        const conditions = Object.entries(options.filter).map(([k], i) => {
          if (!SAFE_IDENTIFIER_RE.test(k)) {
            throw new Error(`Invalid filter column name: ${k}`)
          }
          params.push(options.filter![k])
          return `"${escapeIdent(k)}" = $${i + 2}`
        })
        sql += ` WHERE ${conditions.join(" AND ")}`
      }

      sql += ` ORDER BY "${escapeIdent(options.vectorColumn)}" ${op} $1 LIMIT ${topK}`

      const rows = (await queryFn(sql, params)) as Array<Record<string, unknown>>

      return rows.map((row) => ({
        id: row.id as string,
        content: options.contentColumn ? (row[options.contentColumn] as string) : undefined,
        score: 1 - (row._distance as number),
        row,
      }))
    },
  }
}
