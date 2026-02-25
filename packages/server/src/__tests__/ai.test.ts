import { describe, it, expect } from "vitest"
import { mockAiProvider, createAiContext, type AiProvider } from "../ai/ai.js"

describe("mockAiProvider", () => {
  it("generates deterministic embeddings", async () => {
    const provider = mockAiProvider({ embeddingDimensions: 4 })

    const [emb1] = await provider.embed(["hello"])
    const [emb2] = await provider.embed(["hello"])

    expect(emb1).toHaveLength(4)
    expect(emb1).toEqual(emb2) // Deterministic
  })

  it("generates different embeddings for different texts", async () => {
    const provider = mockAiProvider({ embeddingDimensions: 3 })

    const [emb1] = await provider.embed(["hello"])
    const [emb2] = await provider.embed(["world"])

    expect(emb1).not.toEqual(emb2)
  })

  it("embeds multiple texts in batch", async () => {
    const provider = mockAiProvider()
    const embeddings = await provider.embed(["hello", "world", "test"])

    expect(embeddings).toHaveLength(3)
    expect(embeddings[0]).toHaveLength(3)
  })

  it("generates mock text responses", async () => {
    const provider = mockAiProvider({ generateResponse: "Custom response" })
    const result = await provider.generate!("test prompt")

    expect(result.text).toBe("Custom response")
  })
})

describe("createAiContext", () => {
  it("wraps provider with context methods", async () => {
    const provider = mockAiProvider({ embeddingDimensions: 4 })
    const ctx = createAiContext(provider)

    const embedding = await ctx.embed("hello world")
    expect(embedding).toHaveLength(4)
  })

  it("supports batch embedding", async () => {
    const provider = mockAiProvider()
    const ctx = createAiContext(provider)

    const embeddings = await ctx.embedBatch(["a", "b", "c"])
    expect(embeddings).toHaveLength(3)
  })

  it("delegates generate to provider", async () => {
    const provider = mockAiProvider({ generateResponse: "42" })
    const ctx = createAiContext(provider)

    const result = await ctx.generate("What is the meaning of life?")
    expect(result.text).toBe("42")
  })

  it("throws when generate is not supported", async () => {
    const provider: AiProvider = { name: "no-gen", embed: async (t: string[]) => t.map(() => [0]) }
    const ctx = createAiContext(provider)

    await expect(ctx.generate("test")).rejects.toThrow("does not support generation")
  })

  it("throws when search has no query function", async () => {
    const provider = mockAiProvider()
    const ctx = createAiContext(provider)

    await expect(ctx.search("test", { table: "docs", vectorColumn: "embedding" })).rejects.toThrow(
      "requires a database query function",
    )
  })

  it("performs vector search with query function", async () => {
    const provider = mockAiProvider({ embeddingDimensions: 3 })
    const mockQuery = async (_sql: string, _params: unknown[]) => {
      return [
        { id: "1", content: "Hello world", embedding: [0.1, 0.2, 0.3], _distance: 0.1 },
        { id: "2", content: "Test doc", embedding: [0.4, 0.5, 0.6], _distance: 0.3 },
      ]
    }

    const ctx = createAiContext(provider, mockQuery)
    const results = await ctx.search("hello", {
      table: "documents",
      vectorColumn: "embedding",
      contentColumn: "content",
      topK: 5,
    })

    expect(results).toHaveLength(2)
    expect(results[0].id).toBe("1")
    expect(results[0].content).toBe("Hello world")
    expect(results[0].score).toBe(0.9)
  })
})
