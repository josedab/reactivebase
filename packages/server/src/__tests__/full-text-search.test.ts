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
    // TODO: test query builder with various search configurations
    const builder = new SearchQueryBuilder("test_table", [{ column: "title", weight: "A" }])
    expect(builder).toBeInstanceOf(SearchQueryBuilder)
  })

  it("should throw SearchError with correct message", () => {
    // TODO: test search error handling with invalid queries
    const error = new SearchError("invalid query")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("invalid query")
  })
})
