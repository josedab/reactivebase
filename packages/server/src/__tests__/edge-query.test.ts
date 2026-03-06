import { describe, it, expect } from "vitest"
import {
  EdgeQueryLayer,
  EdgeQueryCache,
  InvalidationPropagator,
  ConsistencyManager,
  EdgeQueryError,
  buildCreateEdgeCacheTableSQL,
  buildCreateInvalidationLogTableSQL,
} from "../edge-query/index.js"

describe("edge-query", () => {
  it("should export all expected symbols", () => {
    expect(EdgeQueryLayer).toBeDefined()
    expect(EdgeQueryCache).toBeDefined()
    expect(InvalidationPropagator).toBeDefined()
    expect(ConsistencyManager).toBeDefined()
    expect(EdgeQueryError).toBeDefined()
  })

  it("should generate valid create edge cache table SQL", () => {
    // TODO: verify the SQL string contains CREATE TABLE and expected columns
    const sql = buildCreateEdgeCacheTableSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })

  it("should generate valid create invalidation log table SQL", () => {
    // TODO: verify the SQL contains invalidation-related columns
    const sql = buildCreateInvalidationLogTableSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })
})
