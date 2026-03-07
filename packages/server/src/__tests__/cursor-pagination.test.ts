import { describe, it, expect } from "vitest"
import { QueryBuilder, PaginationError } from "../query-builder/index.js"

describe("cursor-based pagination", () => {
  it("builds a paginated query with no cursor (first page)", () => {
    const qb = new QueryBuilder("tasks").where("done", false).orderBy("createdAt", "desc")

    const built = qb.buildPaginated({ limit: 10 })

    expect(built.sql).toContain("ORDER BY")
    expect(built.sql).toContain("LIMIT 11") // limit + 1
    expect(built.sql).not.toContain("OFFSET")
    expect(built.sql).toContain('"createdAt" DESC')
    // Should have id tie-breaker appended
    expect(built.sql).toContain('"id" ASC')
  })

  it("adds cursor WHERE clause for subsequent pages", () => {
    const qb = new QueryBuilder("tasks").orderBy("createdAt", "desc")

    // First page
    const firstPage = qb.buildPaginated({ limit: 2 })
    expect(firstPage.sql).not.toContain(">")

    // Simulate getting a cursor from results
    const rows = [
      { id: "1", createdAt: "2024-01-03", title: "A" },
      { id: "2", createdAt: "2024-01-02", title: "B" },
      { id: "3", createdAt: "2024-01-01", title: "C" }, // extra row = hasMore
    ]

    const result = QueryBuilder.toPaginatedResult(rows, 2, ["createdAt"])
    expect(result.hasMore).toBe(true)
    expect(result.data).toHaveLength(2)
    expect(result.nextCursor).toBeTruthy()

    // Second page uses the cursor
    const secondPage = qb.buildPaginated({ limit: 2, cursor: result.nextCursor! })
    expect(secondPage.sql).toContain("<") // DESC order uses <
    expect(secondPage.params.length).toBeGreaterThan(0)
  })

  it("toPaginatedResult returns no cursor when no more pages", () => {
    const rows = [{ id: "1", createdAt: "2024-01-01", title: "A" }]

    const result = QueryBuilder.toPaginatedResult(rows, 10, ["createdAt"])
    expect(result.hasMore).toBe(false)
    expect(result.data).toHaveLength(1)
    expect(result.nextCursor).toBeNull()
  })

  it("toPaginatedResult handles empty results", () => {
    const result = QueryBuilder.toPaginatedResult([], 10, ["createdAt"])
    expect(result.hasMore).toBe(false)
    expect(result.data).toHaveLength(0)
    expect(result.nextCursor).toBeNull()
  })

  it("throws PaginationError without orderBy", () => {
    const qb = new QueryBuilder("tasks")
    expect(() => qb.buildPaginated({ limit: 10 })).toThrow(PaginationError)
  })

  it("throws PaginationError with invalid limit", () => {
    const qb = new QueryBuilder("tasks").orderBy("id")
    expect(() => qb.buildPaginated({ limit: 0 })).toThrow(PaginationError)
    expect(() => qb.buildPaginated({ limit: -1 })).toThrow(PaginationError)
  })

  it("throws PaginationError with invalid cursor", () => {
    const qb = new QueryBuilder("tasks").orderBy("id")
    expect(() => qb.buildPaginated({ limit: 10, cursor: "not-a-valid-cursor" })).toThrow(PaginationError)
  })

  it("works with ASC ordering", () => {
    const qb = new QueryBuilder("tasks").orderBy("createdAt", "asc")

    const rows = [
      { id: "1", createdAt: "2024-01-01" },
      { id: "2", createdAt: "2024-01-02" },
      { id: "3", createdAt: "2024-01-03" },
    ]

    const result = QueryBuilder.toPaginatedResult(rows, 2, ["createdAt"])
    expect(result.hasMore).toBe(true)
    expect(result.data).toHaveLength(2)

    const secondPage = qb.buildPaginated({ limit: 2, cursor: result.nextCursor! })
    // ASC order uses >
    expect(secondPage.sql).toContain(">")
  })

  it("preserves WHERE filters alongside cursor", () => {
    const qb = new QueryBuilder("tasks").where("done", false).orderBy("createdAt", "desc")

    const rows = [
      { id: "1", createdAt: "2024-01-03", done: false },
      { id: "2", createdAt: "2024-01-02", done: false },
      { id: "3", createdAt: "2024-01-01", done: false },
    ]

    const result = QueryBuilder.toPaginatedResult(rows, 2, ["createdAt"])
    const built = qb.buildPaginated({ limit: 2, cursor: result.nextCursor! })

    // Should have both the original WHERE and the cursor WHERE
    expect(built.sql).toContain('"done"')
    expect(built.sql).toContain("<") // cursor condition
  })

  it("handles multiple sort columns", () => {
    const qb = new QueryBuilder("tasks").orderBy("priority", "desc").orderBy("createdAt", "asc")

    const built = qb.buildPaginated({ limit: 5 })
    expect(built.sql).toContain('"priority" DESC')
    expect(built.sql).toContain('"createdAt" ASC')
    expect(built.sql).toContain('"id" ASC')
  })

  it("round-trips cursor encode/decode correctly", () => {
    const rows = [
      { id: "abc-123", score: 95, name: "Alice" },
      { id: "def-456", score: 87, name: "Bob" },
      { id: "ghi-789", score: 72, name: "Charlie" },
    ]

    const result = QueryBuilder.toPaginatedResult(rows, 2, ["score"])
    expect(result.nextCursor).toBeTruthy()

    // The cursor should be decodeable on the next page request
    const qb = new QueryBuilder("users").orderBy("score", "desc")
    const built = qb.buildPaginated({ limit: 2, cursor: result.nextCursor! })
    expect(built.params).toContain(87) // score value from last row
    expect(built.params).toContain("def-456") // id from last row
  })
})
