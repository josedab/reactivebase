import { describe, it, expect } from "vitest"
import {
  SearchQueryBuilder,
  SearchError,
  generateSearchIndexSQL,
  generateFacetSQL,
  createSearchQuery,
  searchTable,
} from "../full-text-search/index.js"

describe("full-text-search", () => {
  it("should export all expected symbols", () => {
    expect(SearchQueryBuilder).toBeDefined()
    expect(SearchError).toBeDefined()
    expect(generateSearchIndexSQL).toBeDefined()
    expect(generateFacetSQL).toBeDefined()
    expect(createSearchQuery).toBeDefined()
    expect(searchTable).toBeDefined()
  })

  it("should create a SearchQueryBuilder instance", () => {
    const builder = new SearchQueryBuilder("test_table", [{ column: "title", weight: "A" }])
    expect(builder).toBeInstanceOf(SearchQueryBuilder)
  })

  it.todo("should test query builder with various search configurations")

  it("should throw SearchError with correct message", () => {
    const error = new SearchError("invalid query")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("invalid query")
  })

  it.todo("should test search error handling with invalid queries")
})
