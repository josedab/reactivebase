import { describe, it, expect } from "vitest"
import { defineSchema, defineTable, v } from "../schema/index.js"
import { generateMigrationSQL, generateIndexSQL } from "../schema/migrations.js"
import { QueryBuilder } from "../query-builder/query-builder.js"

describe("v.vector()", () => {
  it("creates a vector validator with correct Postgres type", () => {
    const validator = v.vector(1536)
    expect(validator.type).toBe("vector")
    expect(validator.pgType).toBe("vector(1536)")
    expect(validator.dimensions).toBe(1536)
  })

  it("supports common embedding dimensions", () => {
    expect(v.vector(384).pgType).toBe("vector(384)")
    expect(v.vector(768).pgType).toBe("vector(768)")
    expect(v.vector(1536).pgType).toBe("vector(1536)")
    expect(v.vector(3072).pgType).toBe("vector(3072)")
  })
})

describe("vector index", () => {
  it("generates HNSW vector index SQL", () => {
    const sql = generateIndexSQL("documents", "documents_embedding_idx", ["embedding"], false, "hnsw", "vector_cosine_ops")
    expect(sql).toContain("USING hnsw")
    expect(sql).toContain("vector_cosine_ops")
  })

  it("generates IVFFlat vector index SQL", () => {
    const sql = generateIndexSQL("documents", "documents_embedding_idx", ["embedding"], false, "ivfflat", "vector_l2_ops")
    expect(sql).toContain("USING ivfflat")
    expect(sql).toContain("vector_l2_ops")
  })

  it("defines vector index on table", () => {
    const table = defineTable({
      content: v.string(),
      embedding: v.vector(1536),
    }).vectorIndex("embedding_idx", "embedding", { metric: "cosine" })

    expect(table.indexes).toHaveLength(1)
    expect(table.indexes[0].type).toBe("hnsw")
    expect(table.indexes[0].opclass).toBe("vector_cosine_ops")
  })
})

describe("vector migration generation", () => {
  it("adds pgvector extension when schema has vector columns", () => {
    const schema = defineSchema({
      documents: defineTable({
        content: v.string(),
        embedding: v.vector(1536),
      }).vectorIndex("embedding_idx", "embedding"),
    })

    const migration = generateMigrationSQL(schema)
    expect(migration.up).toContain("CREATE EXTENSION IF NOT EXISTS vector")
    expect(migration.up).toContain("vector(1536)")
    expect(migration.up).toContain("USING hnsw")
  })

  it("does not add pgvector extension when no vector columns", () => {
    const schema = defineSchema({
      users: defineTable({ name: v.string() }),
    })

    const migration = generateMigrationSQL(schema)
    expect(migration.up).not.toContain("CREATE EXTENSION")
  })
})

describe("vector query builder", () => {
  it("generates cosine similarity ORDER BY", () => {
    const builder = new QueryBuilder("documents")
      .whereVectorSimilar("embedding", [0.1, 0.2, 0.3], { topK: 5, metric: "cosine" })

    const { sql, params } = builder.build()
    expect(sql).toContain("ORDER BY")
    expect(sql).toContain("<=>")
    expect(sql).toContain("LIMIT 5")
    expect(params).toHaveLength(1)
    expect(params[0]).toBe("[0.1,0.2,0.3]")
  })

  it("generates L2 distance ORDER BY", () => {
    const builder = new QueryBuilder("documents")
      .whereVectorSimilar("embedding", [1, 2, 3], { metric: "l2" })

    const { sql } = builder.build()
    expect(sql).toContain("<->")
  })

  it("generates inner product ORDER BY", () => {
    const builder = new QueryBuilder("documents")
      .whereVectorSimilar("embedding", [1, 2], { metric: "inner_product" })

    const { sql } = builder.build()
    expect(sql).toContain("<#>")
  })

  it("combines vector search with where clauses", () => {
    const builder = new QueryBuilder("documents")
      .where({ category: "tech" })
      .whereVectorSimilar("embedding", [0.1, 0.2], { topK: 10 })

    const { sql, params } = builder.build()
    expect(sql).toContain("WHERE")
    expect(sql).toContain('"category"')
    expect(sql).toContain("<=>")
    expect(params).toHaveLength(2) // category value + embedding
  })

  it("tracks vector table as dependency", () => {
    const builder = new QueryBuilder("documents")
      .whereVectorSimilar("embedding", [0.1], { topK: 5 })

    const deps = builder.getDependencies()
    expect(deps).toEqual([{ table: "documents", filters: {} }])
  })
})
