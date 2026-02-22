import { describe, it, expect } from "vitest"
import { EmbeddedPoolAdapter, type PGliteLike } from "../embedded/embedded.js"

function createMockPGlite(): PGliteLike & { queries: string[] } {
  const queries: string[] = []
  return {
    queries,
    async query(sql: string, _params?: unknown[]) {
      queries.push(sql)

      // Simulate basic responses
      if (sql.includes("INSERT") && sql.includes("RETURNING")) {
        return { rows: [{ id: "mock_id_1" }] }
      }
      if (sql.includes("SELECT")) {
        return { rows: [{ id: "1", name: "test" }] }
      }
      return { rows: [] }
    },
    async close() {},
  }
}

describe("EmbeddedPoolAdapter", () => {
  it("wraps PGlite as a pool", async () => {
    const pglite = createMockPGlite()
    const pool = new EmbeddedPoolAdapter(pglite)

    const result = await pool.query("SELECT 1")
    expect(result.rows).toBeDefined()
    expect(pglite.queries).toContain("SELECT 1")
  })

  it("provides connect/release client interface", async () => {
    const pglite = createMockPGlite()
    const pool = new EmbeddedPoolAdapter(pglite)

    const client = await pool.connect()
    const result = await client.query("SELECT * FROM users")
    expect(result.rows).toHaveLength(1)

    // Release should not throw
    client.release()
  })

  it("supports transaction queries", async () => {
    const pglite = createMockPGlite()
    const pool = new EmbeddedPoolAdapter(pglite)

    const client = await pool.connect()
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")
    await client.query("INSERT INTO tasks (title) VALUES ($1) RETURNING *", ["Test"])
    await client.query("COMMIT")
    client.release()

    expect(pglite.queries).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE")
    expect(pglite.queries).toContain("COMMIT")
  })

  it("closes the pool", async () => {
    const pglite = createMockPGlite()
    const pool = new EmbeddedPoolAdapter(pglite)

    await pool.end()
    // Should not throw
  })

  it("supports debug mode", async () => {
    const pglite = createMockPGlite()
    const pool = new EmbeddedPoolAdapter(pglite, { debug: true })

    // Should not throw with debug enabled
    await pool.query("SELECT 1")
  })
})
