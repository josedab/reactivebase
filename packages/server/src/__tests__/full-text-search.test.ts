import { describe, it, expect } from "vitest"
import {
  SearchQueryBuilder,
  SearchError,
  generateSearchIndexSQL,
  generateFacetSQL,
  createSearchQuery,
  searchTable,
} from "../full-text-search/index.js"
import type { SearchableColumnConfig } from "../full-text-search/index.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeColumns(names: string[], weight?: "A" | "B" | "C" | "D"): SearchableColumnConfig[] {
  return names.map((column) => (weight ? { column, weight } : { column }))
}

function buildSearch(table: string, columns: SearchableColumnConfig[], query: string) {
  return new SearchQueryBuilder(table, columns).search(query).build()
}

// ─── Exports ─────────────────────────────────────────────────────────────────

describe("full-text-search", () => {
  it("should export all expected symbols", () => {
    expect(SearchQueryBuilder).toBeDefined()
    expect(SearchError).toBeDefined()
    expect(generateSearchIndexSQL).toBeDefined()
    expect(generateFacetSQL).toBeDefined()
    expect(createSearchQuery).toBeDefined()
    expect(searchTable).toBeDefined()
  })
})

// ─── SearchError ─────────────────────────────────────────────────────────────

describe("SearchError", () => {
  it("should be an instance of Error with correct properties", () => {
    const error = new SearchError("bad query")
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("SearchError")
    expect(error.message).toBe("bad query")
    expect(error.code).toBe("SEARCH_ERROR")
  })
})

// ─── SearchQueryBuilder ──────────────────────────────────────────────────────

describe("SearchQueryBuilder", () => {
  describe("basic full-text search", () => {
    it("generates plainto_tsquery SQL for a single column", () => {
      const { sql, params } = buildSearch("articles", makeColumns(["title"]), "hello world")

      expect(sql).toContain("plainto_tsquery('english', $1)")
      expect(sql).toContain(`to_tsvector('english', COALESCE("title", ''))`)
      expect(sql).toContain('FROM "articles"')
      expect(sql).toContain("@@")
      expect(params).toEqual(["hello world"])
    })

    it("generates tsvector || concatenation for multiple columns", () => {
      const { sql } = buildSearch("articles", makeColumns(["title", "body"]), "test")

      expect(sql).toContain(`to_tsvector('english', COALESCE("title", ''))`)
      expect(sql).toContain(`to_tsvector('english', COALESCE("body", ''))`)
      expect(sql).toContain("||")
    })

    it("applies setweight when columns have weights", () => {
      const cols: SearchableColumnConfig[] = [
        { column: "title", weight: "A" },
        { column: "body", weight: "D" },
      ]
      const { sql } = new SearchQueryBuilder("articles", cols).search("test").build()

      expect(sql).toContain("setweight(to_tsvector('english', COALESCE(\"title\", '')), 'A')")
      expect(sql).toContain("setweight(to_tsvector('english', COALESCE(\"body\", '')), 'D')")
    })

    it("includes _rank in SELECT using ts_rank by default", () => {
      const { sql } = buildSearch("articles", makeColumns(["title"]), "test")
      expect(sql).toContain("ts_rank(")
      expect(sql).toContain('AS "_rank"')
    })

    it("uses ts_rank_cd when specified", () => {
      const { sql } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test", { rankFunction: "ts_rank_cd" })
        .build()

      expect(sql).toContain("ts_rank_cd(")
    })

    it("orders by _rank DESC", () => {
      const { sql } = buildSearch("articles", makeColumns(["title"]), "test")
      expect(sql).toContain('ORDER BY "_rank" DESC')
    })
  })

  describe("language support", () => {
    it("uses specified language for tsquery and tsvector", () => {
      const { sql } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("prueba", { language: "spanish" })
        .build()

      expect(sql).toContain("plainto_tsquery('spanish', $1)")
      expect(sql).toContain("to_tsvector('spanish'")
    })

    it("uses per-column language when specified", () => {
      const cols: SearchableColumnConfig[] = [
        { column: "title_en", language: "english" },
        { column: "title_fr", language: "french" },
      ]
      const { sql } = new SearchQueryBuilder("articles", cols).search("test").build()

      expect(sql).toContain("to_tsvector('english', COALESCE(\"title_en\", ''))")
      expect(sql).toContain("to_tsvector('french', COALESCE(\"title_fr\", ''))")
    })

    it("throws on invalid language", () => {
      expect(() => {
        new SearchQueryBuilder("t", makeColumns(["title"])).search("x", { language: "klingon" as never }).build()
      }).toThrow(SearchError)
    })
  })

  describe(".where() filters", () => {
    it("generates AND clause with parameterized value", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test")
        .where("status", "=", "published")
        .build()

      expect(sql).toContain('AND "status" = $2')
      expect(params).toEqual(["test", "published"])
    })

    it("supports multiple where clauses", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test")
        .where("status", "=", "published")
        .where("category", "ILIKE", "%tech%")
        .build()

      expect(sql).toContain('AND "status" = $2')
      expect(sql).toContain('AND "category" ILIKE $3')
      expect(params).toEqual(["test", "published", "%tech%"])
    })

    it("supports various operators", () => {
      for (const op of ["=", "!=", "<", ">", "<=", ">=", "LIKE", "ILIKE", "IN", "IS"]) {
        const { sql } = new SearchQueryBuilder("t", makeColumns(["c"])).search("q").where("col", op, "v").build()
        expect(sql).toContain(`"col" ${op} $2`)
      }
    })

    it("throws on invalid operator", () => {
      expect(() => {
        new SearchQueryBuilder("t", makeColumns(["c"])).search("q").where("col", "DROP TABLE", "x").build()
      }).toThrow(SearchError)
    })
  })

  describe(".limit() and .offset()", () => {
    it("generates LIMIT clause with parameter", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test")
        .limit(10)
        .build()

      expect(sql).toContain("LIMIT $2")
      expect(params).toContain(10)
    })

    it("generates OFFSET clause with parameter", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test")
        .offset(20)
        .build()

      expect(sql).toContain("OFFSET $2")
      expect(params).toContain(20)
    })

    it("generates both LIMIT and OFFSET in correct order", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test")
        .limit(10)
        .offset(20)
        .build()

      const limitIdx = sql.indexOf("LIMIT")
      const offsetIdx = sql.indexOf("OFFSET")
      expect(limitIdx).toBeLessThan(offsetIdx)
      expect(params).toEqual(["test", 10, 20])
    })

    it("can be set via SearchOptions", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test", { limit: 5, offset: 10 })
        .build()

      expect(sql).toContain("LIMIT")
      expect(sql).toContain("OFFSET")
      expect(params).toContain(5)
      expect(params).toContain(10)
    })

    it("throws on negative limit", () => {
      expect(() => {
        new SearchQueryBuilder("t", makeColumns(["c"])).search("q").limit(-1).build()
      }).toThrow(SearchError)
    })

    it("throws on negative offset", () => {
      expect(() => {
        new SearchQueryBuilder("t", makeColumns(["c"])).search("q").offset(-1).build()
      }).toThrow(SearchError)
    })
  })

  describe(".highlight()", () => {
    it("generates ts_headline SQL with default options", () => {
      const { sql } = new SearchQueryBuilder("articles", makeColumns(["title"])).search("test").highlight().build()

      expect(sql).toContain("ts_headline('english'")
      expect(sql).toContain("COALESCE(\"title\", '')")
      expect(sql).toContain('AS "_hl_title"')
      expect(sql).toContain("StartSel=<b>")
      expect(sql).toContain("StopSel=</b>")
      expect(sql).toContain("MaxWords=35")
      expect(sql).toContain("MinWords=15")
    })

    it("generates ts_headline for each searchable column", () => {
      const { sql } = new SearchQueryBuilder("articles", makeColumns(["title", "body"]))
        .search("test")
        .highlight()
        .build()

      expect(sql).toContain('AS "_hl_title"')
      expect(sql).toContain('AS "_hl_body"')
    })

    it("uses custom highlight tags", () => {
      const { sql } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test")
        .highlight({ startTag: "<mark>", endTag: "</mark>" })
        .build()

      expect(sql).toContain("StartSel=<mark>")
      expect(sql).toContain("StopSel=</mark>")
    })

    it("uses custom maxWords and minWords", () => {
      const { sql } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test")
        .highlight({ maxWords: 50, minWords: 10 })
        .build()

      expect(sql).toContain("MaxWords=50")
      expect(sql).toContain("MinWords=10")
    })

    it("uses custom fragment delimiter", () => {
      const { sql } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test")
        .highlight({ fragmentDelimiter: "---" })
        .build()

      expect(sql).toContain("FragmentDelimiter=---")
    })

    it("can also be set via SearchOptions.highlight", () => {
      const { sql } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test", { highlight: { startTag: "<em>", endTag: "</em>" } })
        .build()

      expect(sql).toContain("StartSel=<em>")
      expect(sql).toContain("StopSel=</em>")
    })

    it("uses per-column language for ts_headline", () => {
      const cols: SearchableColumnConfig[] = [{ column: "title_fr", language: "french" }]
      const { sql } = new SearchQueryBuilder("articles", cols).search("test").highlight().build()

      expect(sql).toContain("ts_headline('french'")
    })
  })

  describe(".minRank()", () => {
    it("adds rank threshold filter when minRank is set", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .search("test", { minRank: 0.5 })
        .build()

      expect(sql).toContain("ts_rank(")
      expect(sql).toContain(">= $2")
      expect(params).toContain(0.5)
    })
  })

  describe("fuzzy search", () => {
    it("generates trigram similarity SQL by default", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"])).fuzzy("helo").build()

      expect(sql).toContain('similarity("title", $1)')
      expect(sql).toContain('AS "_rank"')
      expect(sql).toContain("WHERE")
      expect(sql).toContain("> $2")
      expect(params[0]).toBe("helo")
      expect(params[1]).toBe(0.3) // default threshold
    })

    it("uses custom threshold for trigram", () => {
      const { params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .fuzzy("helo", { threshold: 0.5 })
        .build()

      expect(params[1]).toBe(0.5)
    })

    it("generates OR conditions for multiple columns in trigram", () => {
      const { sql } = new SearchQueryBuilder("articles", makeColumns(["title", "body"])).fuzzy("helo").build()

      expect(sql).toContain('similarity("title", $1)')
      expect(sql).toContain('similarity("body", $1)')
      expect(sql).toContain("OR")
    })

    it("generates levenshtein distance SQL", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .fuzzy("helo", { matchType: "levenshtein" })
        .build()

      expect(sql).toContain('levenshtein("title", $1)')
      expect(sql).toContain('AS "_distance"')
      expect(sql).toContain('ORDER BY "_distance" ASC')
      expect(params[0]).toBe("helo")
    })

    it("combines levenshtein distances for multiple columns", () => {
      const { sql } = new SearchQueryBuilder("articles", makeColumns(["title", "body"]))
        .fuzzy("helo", { matchType: "levenshtein" })
        .build()

      expect(sql).toContain('levenshtein("title", $1)')
      expect(sql).toContain('levenshtein("body", $1)')
      expect(sql).toContain("+")
    })

    it("applies filters to fuzzy trigram queries", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .fuzzy("helo")
        .where("status", "=", "published")
        .build()

      expect(sql).toContain('AND "status" = $3')
      expect(params[2]).toBe("published")
    })

    it("applies limit and offset to fuzzy queries", () => {
      const { sql, params } = new SearchQueryBuilder("articles", makeColumns(["title"]))
        .fuzzy("helo")
        .limit(5)
        .offset(10)
        .build()

      expect(sql).toContain("LIMIT")
      expect(sql).toContain("OFFSET")
      expect(params).toContain(5)
      expect(params).toContain(10)
    })
  })

  describe("immutability (clone behavior)", () => {
    it("does not mutate original builder when chaining", () => {
      const base = new SearchQueryBuilder("articles", makeColumns(["title"])).search("base query")

      const withLimit = base.limit(10)
      const withOffset = base.offset(5)

      const limitResult = withLimit.build()
      const offsetResult = withOffset.build()

      expect(limitResult.sql).toContain("LIMIT")
      expect(limitResult.sql).not.toContain("OFFSET")
      expect(offsetResult.sql).toContain("OFFSET")
      expect(offsetResult.sql).not.toContain("LIMIT")
    })

    it("does not share filter arrays between clones", () => {
      const base = new SearchQueryBuilder("articles", makeColumns(["title"])).search("test")
      const withFilter = base.where("status", "=", "published")

      const baseResult = base.build()
      const filterResult = withFilter.build()

      expect(baseResult.sql).not.toContain('"status"')
      expect(filterResult.sql).toContain('"status"')
    })
  })

  describe("chained operations", () => {
    it("builds a complex query with all options", () => {
      const cols: SearchableColumnConfig[] = [
        { column: "title", weight: "A" },
        { column: "body", weight: "C" },
      ]
      const { sql, params } = new SearchQueryBuilder("articles", cols)
        .search("reactive search", { language: "english", rankFunction: "ts_rank_cd" })
        .where("status", "=", "published")
        .where("author_id", ">", 0)
        .highlight({ startTag: "<em>", endTag: "</em>" })
        .limit(20)
        .offset(40)
        .build()

      expect(sql).toContain("ts_rank_cd(")
      expect(sql).toContain("plainto_tsquery('english', $1)")
      expect(sql).toContain('AND "status" = $2')
      expect(sql).toContain('AND "author_id" > $3')
      expect(sql).toContain("ts_headline(")
      expect(sql).toContain("StartSel=<em>")
      expect(sql).toContain("LIMIT $4")
      expect(sql).toContain("OFFSET $5")
      expect(params).toEqual(["reactive search", "published", 0, 20, 40])
    })
  })

  describe(".build() without search or fuzzy", () => {
    it("throws SearchError when neither search nor fuzzy is called", () => {
      const builder = new SearchQueryBuilder("t", makeColumns(["c"]))
      expect(() => builder.build()).toThrow(SearchError)
      expect(() => builder.build()).toThrow("Either search() or fuzzy() must be called before build()")
    })
  })

  describe(".getDependencies()", () => {
    it("returns table dependency for reactivity tracking", () => {
      const builder = new SearchQueryBuilder("articles", makeColumns(["title"]))
      const deps = builder.getDependencies()

      expect(deps).toEqual([{ table: "articles", filters: {} }])
    })
  })
})

// ─── generateSearchIndexSQL ──────────────────────────────────────────────────

describe("generateSearchIndexSQL", () => {
  it("generates ALTER TABLE with generated tsvector column", () => {
    const sql = generateSearchIndexSQL("articles", { columns: ["title"] })

    expect(sql).toContain('ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "_search_vector"')
    expect(sql).toContain("tsvector GENERATED ALWAYS AS")
    expect(sql).toContain("to_tsvector('english', COALESCE(\"title\", ''))")
    expect(sql).toContain("STORED")
  })

  it("creates GIN index on the search vector", () => {
    const sql = generateSearchIndexSQL("articles", { columns: ["title"] })

    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_articles_search"')
    expect(sql).toContain('ON "articles" USING GIN ("_search_vector")')
  })

  it("handles multiple searchable columns with || concatenation", () => {
    const sql = generateSearchIndexSQL("articles", { columns: ["title", "body", "tags"] })

    expect(sql).toContain("to_tsvector('english', COALESCE(\"title\", ''))")
    expect(sql).toContain("to_tsvector('english', COALESCE(\"body\", ''))")
    expect(sql).toContain("to_tsvector('english', COALESCE(\"tags\", ''))")
    expect(sql).toContain("||")
  })

  it("supports different languages", () => {
    const sql = generateSearchIndexSQL("articles", { columns: ["title"], language: "spanish" })

    expect(sql).toContain("to_tsvector('spanish'")
    expect(sql).toContain("Language: spanish")
  })

  it("uses simple language", () => {
    const sql = generateSearchIndexSQL("articles", { columns: ["title"], language: "simple" })
    expect(sql).toContain("to_tsvector('simple'")
  })

  it("applies setweight when weights are specified", () => {
    const sql = generateSearchIndexSQL("articles", {
      columns: ["title", "body"],
      weights: { title: "A", body: "C" },
    })

    expect(sql).toContain("setweight(to_tsvector('english', COALESCE(\"title\", '')), 'A')")
    expect(sql).toContain("setweight(to_tsvector('english', COALESCE(\"body\", '')), 'C')")
  })

  it("creates pg_trgm GIN indexes when enableFuzzy is true", () => {
    const sql = generateSearchIndexSQL("articles", {
      columns: ["title", "body"],
      enableFuzzy: true,
    })

    expect(sql).toContain('"idx_articles_title_trgm"')
    expect(sql).toContain('"idx_articles_body_trgm"')
    expect(sql).toContain("gin_trgm_ops")
  })

  it("does not create pg_trgm indexes when enableFuzzy is false", () => {
    const sql = generateSearchIndexSQL("articles", { columns: ["title"] })
    expect(sql).not.toContain("trgm")
  })

  it("includes comment with column list and language", () => {
    const sql = generateSearchIndexSQL("articles", {
      columns: ["title", "body"],
      language: "french",
    })

    expect(sql).toContain("Columns: title, body")
    expect(sql).toContain("Language: french")
  })

  it("throws on invalid table name", () => {
    expect(() => generateSearchIndexSQL("drop table;", { columns: ["title"] })).toThrow(SearchError)
  })

  it("throws on invalid column name in columns", () => {
    expect(() => generateSearchIndexSQL("articles", { columns: ["valid", "bad column!"] })).toThrow(SearchError)
  })

  it("throws on invalid language", () => {
    expect(() => generateSearchIndexSQL("articles", { columns: ["title"], language: "invalid" as never })).toThrow(
      SearchError,
    )
  })

  it("throws on invalid weight", () => {
    expect(() =>
      generateSearchIndexSQL("articles", {
        columns: ["title"],
        weights: { title: "Z" as never },
      }),
    ).toThrow(SearchError)
  })
})

// ─── generateFacetSQL ────────────────────────────────────────────────────────

describe("generateFacetSQL", () => {
  it("generates GROUP BY aggregation SQL ordered by count", () => {
    const sql = generateFacetSQL("articles", "category", {
      column: "category",
      orderBy: "count",
      limit: 10,
    })

    expect(sql).toContain('SELECT "category" AS value, COUNT(*) AS count')
    expect(sql).toContain('FROM "articles"')
    expect(sql).toContain('GROUP BY "category"')
    expect(sql).toContain("ORDER BY count DESC")
    expect(sql).toContain("LIMIT 10")
  })

  it("orders by value when specified", () => {
    const sql = generateFacetSQL("articles", "category", {
      column: "category",
      orderBy: "value",
    })

    expect(sql).toContain('ORDER BY "category" ASC')
  })

  it("omits LIMIT when not specified", () => {
    const sql = generateFacetSQL("articles", "category", { column: "category" })
    expect(sql).not.toMatch(/LIMIT \d+/)
  })

  it("handles different facet dimensions", () => {
    const sqlCategory = generateFacetSQL("articles", "category", {
      column: "category",
      orderBy: "count",
      limit: 5,
    })
    const sqlAuthor = generateFacetSQL("articles", "author", {
      column: "author",
      orderBy: "count",
      limit: 5,
    })

    expect(sqlCategory).toContain('GROUP BY "category"')
    expect(sqlAuthor).toContain('GROUP BY "author"')
  })
})

// ─── createSearchQuery ───────────────────────────────────────────────────────

describe("createSearchQuery", () => {
  it("returns a SearchQueryBuilder instance", () => {
    const builder = createSearchQuery("articles", makeColumns(["title"]))
    expect(builder).toBeInstanceOf(SearchQueryBuilder)
  })

  it("can chain search and build", () => {
    const { sql, params } = createSearchQuery("articles", makeColumns(["title"]))
      .search("hello")
      .build()

    expect(sql).toContain("plainto_tsquery('english', $1)")
    expect(params).toEqual(["hello"])
  })
})

// ─── searchTable ─────────────────────────────────────────────────────────────

describe("searchTable", () => {
  it("creates a builder already configured with search", () => {
    const builder = searchTable("articles", ["title", "body"], "reactive")
    expect(builder).toBeInstanceOf(SearchQueryBuilder)
  })

  it("builds valid SQL from string column names", () => {
    const { sql, params } = searchTable("articles", ["title", "body"], "reactive").build()

    expect(sql).toContain("plainto_tsquery('english', $1)")
    expect(sql).toContain("to_tsvector('english', COALESCE(\"title\", ''))")
    expect(sql).toContain("to_tsvector('english', COALESCE(\"body\", ''))")
    expect(params).toEqual(["reactive"])
  })

  it("accepts SearchOptions", () => {
    const { sql } = searchTable("articles", ["title"], "test", {
      language: "french",
      limit: 5,
    }).build()

    expect(sql).toContain("plainto_tsquery('french', $1)")
    expect(sql).toContain("LIMIT")
  })

  it("can be chained further", () => {
    const { sql, params } = searchTable("articles", ["title"], "test")
      .where("status", "=", "published")
      .limit(10)
      .build()

    expect(sql).toContain('AND "status" = $2')
    expect(sql).toContain("LIMIT $3")
    expect(params).toEqual(["test", "published", 10])
  })
})

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases", () => {
  describe("SQL injection prevention", () => {
    it("rejects column names with special characters", () => {
      expect(() => {
        new SearchQueryBuilder("t", [{ column: "col; DROP TABLE" }]).search("test").build()
      }).toThrow(SearchError)
    })

    it("rejects column names starting with numbers", () => {
      expect(() => {
        new SearchQueryBuilder("t", [{ column: "1col" }]).search("test").build()
      }).toThrow(SearchError)
    })

    it("rejects column names with spaces", () => {
      expect(() => {
        new SearchQueryBuilder("t", [{ column: "bad column" }]).search("test").build()
      }).toThrow(SearchError)
    })

    it("accepts valid column names with underscores", () => {
      const { sql } = buildSearch("t", [{ column: "my_column_2" }], "test")
      expect(sql).toContain('"my_column_2"')
    })

    it("sanitizes single quotes in highlight tags", () => {
      const { sql } = new SearchQueryBuilder("t", makeColumns(["c"]))
        .search("test")
        .highlight({ startTag: "it's<b>", endTag: "</b>" })
        .build()

      expect(sql).toContain("StartSel=it''s<b>")
    })

    it("parameterizes search terms (never inlined)", () => {
      const { sql, params } = buildSearch("t", makeColumns(["c"]), "'; DROP TABLE articles;--")

      expect(sql).not.toContain("DROP TABLE")
      expect(params[0]).toBe("'; DROP TABLE articles;--")
    })

    it("parameterizes filter values", () => {
      const { sql, params } = new SearchQueryBuilder("t", makeColumns(["c"]))
        .search("test")
        .where("status", "=", "'; DROP TABLE --")
        .build()

      expect(sql).not.toContain("DROP TABLE")
      expect(params).toContain("'; DROP TABLE --")
    })
  })

  describe("empty search terms", () => {
    it("throws when search term is empty string (falsy)", () => {
      expect(() => buildSearch("articles", makeColumns(["title"]), "")).toThrow(SearchError)
    })

    it("throws when fuzzy term is empty string (falsy)", () => {
      expect(() => new SearchQueryBuilder("t", makeColumns(["c"])).fuzzy("").build()).toThrow(SearchError)
    })

    it("handles whitespace-only search term (truthy string)", () => {
      const { sql, params } = buildSearch("articles", makeColumns(["title"]), "   ")
      expect(sql).toContain("plainto_tsquery('english', $1)")
      expect(params).toEqual(["   "])
    })
  })

  describe("invalid column names in where()", () => {
    it("throws on invalid column name in where filter", () => {
      expect(() => {
        new SearchQueryBuilder("t", makeColumns(["c"])).search("q").where("bad col!", "=", "v").build()
      }).toThrow(SearchError)
    })
  })

  describe("validation", () => {
    it("rejects NaN as limit", () => {
      expect(() => {
        new SearchQueryBuilder("t", makeColumns(["c"])).search("q").limit(NaN).build()
      }).toThrow(SearchError)
    })

    it("rejects Infinity as offset", () => {
      expect(() => {
        new SearchQueryBuilder("t", makeColumns(["c"])).search("q").offset(Infinity).build()
      }).toThrow(SearchError)
    })

    it("rejects negative minRank", () => {
      expect(() => {
        new SearchQueryBuilder("t", makeColumns(["c"])).search("q", { minRank: -0.5 }).build()
      }).toThrow(SearchError)
    })

    it("rejects negative fuzzy threshold", () => {
      expect(() => {
        new SearchQueryBuilder("t", makeColumns(["c"])).fuzzy("q", { threshold: -1 }).build()
      }).toThrow(SearchError)
    })
  })
})
