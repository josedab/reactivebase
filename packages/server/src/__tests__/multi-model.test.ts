import { describe, it, expect } from "vitest"
import {
  MultiModelQueryBuilder,
  RelationalQueryBuilder,
  DocumentQueryBuilder,
  GraphQueryBuilder,
  MultiModelError as _MultiModelError,
} from "../multi-model/multi-model.js"

describe("MultiModelQueryBuilder", () => {
  const qb = new MultiModelQueryBuilder()

  it("creates relational, document, and graph builders", () => {
    expect(qb.relational("users")).toBeInstanceOf(RelationalQueryBuilder)
    expect(qb.document("profiles")).toBeInstanceOf(DocumentQueryBuilder)
    expect(qb.graph("nodes")).toBeInstanceOf(GraphQueryBuilder)
  })
})

describe("RelationalQueryBuilder", () => {
  it("builds basic SELECT", () => {
    const result = new RelationalQueryBuilder("users").build()
    expect(result.sql).toContain("SELECT *")
    expect(result.sql).toContain('FROM "users"')
    expect(result.model).toBe("relational")
  })

  it("builds SELECT with columns", () => {
    const result = new RelationalQueryBuilder("users").select("id", "name").build()
    expect(result.sql).toContain("SELECT id, name")
  })

  it("builds WHERE conditions", () => {
    const result = new RelationalQueryBuilder("users").where({ active: true, role: "admin" }).build()
    expect(result.sql).toContain("WHERE")
    expect(result.params).toContain(true)
    expect(result.params).toContain("admin")
  })

  it("builds JOINs", () => {
    const result = new RelationalQueryBuilder("users").join("orders", "users.id", "orders.user_id").build()
    expect(result.sql).toContain("INNER JOIN")
  })

  it("builds LEFT JOINs", () => {
    const result = new RelationalQueryBuilder("users").leftJoin("orders", "users.id", "orders.user_id").build()
    expect(result.sql).toContain("LEFT JOIN")
  })

  it("builds ORDER BY", () => {
    const result = new RelationalQueryBuilder("users").orderBy("name", "asc").build()
    expect(result.sql).toContain("ORDER BY")
    expect(result.sql).toContain("ASC")
  })

  it("builds GROUP BY with HAVING", () => {
    const result = new RelationalQueryBuilder("orders")
      .select("user_id", "COUNT(*)")
      .groupBy("user_id")
      .having("COUNT(*) > 5")
      .build()
    expect(result.sql).toContain("GROUP BY")
    expect(result.sql).toContain("HAVING")
  })

  it("builds LIMIT and OFFSET", () => {
    const result = new RelationalQueryBuilder("users").limit(10).offset(20).build()
    expect(result.sql).toContain("LIMIT")
    expect(result.sql).toContain("OFFSET")
    expect(result.params).toContain(10)
    expect(result.params).toContain(20)
  })

  it("builds DISTINCT", () => {
    const result = new RelationalQueryBuilder("users").distinct().build()
    expect(result.sql).toContain("SELECT DISTINCT")
  })

  it("builds WINDOW", () => {
    const result = new RelationalQueryBuilder("orders").window("w", "user_id", "created_at").build()
    expect(result.sql).toContain("WINDOW")
    expect(result.sql).toContain("PARTITION BY")
  })

  it("builds with whereRaw", () => {
    const result = new RelationalQueryBuilder("users").whereRaw("age", ">=", 18).build()
    expect(result.sql).toContain(">=")
    expect(result.params).toContain(18)
  })
})

describe("DocumentQueryBuilder", () => {
  it("builds basic document query", () => {
    const result = new DocumentQueryBuilder("profiles").build()
    expect(result.sql).toContain("SELECT")
    expect(result.sql).toContain('"data"')
    expect(result.model).toBe("document")
  })

  it("builds match conditions", () => {
    const result = new DocumentQueryBuilder("profiles").match({ "settings.theme": "dark" }).build()
    expect(result.sql).toContain("WHERE")
    expect(result.sql).toContain("jsonb")
  })

  it("supports operator matching", () => {
    const result = new DocumentQueryBuilder("profiles").matchOp("age", ">", 18).build()
    expect(result.sql).toContain("::numeric >")
    expect(result.params).toContain(18)
  })

  it("supports contains operator", () => {
    const result = new DocumentQueryBuilder("profiles").matchOp("tags", "contains", ["admin"]).build()
    expect(result.sql).toContain("@>")
  })

  it("supports exists operator", () => {
    const result = new DocumentQueryBuilder("profiles").matchOp("email", "exists", true).build()
    expect(result.sql).toContain("IS NOT NULL")
  })

  it("builds projections", () => {
    const result = new DocumentQueryBuilder("profiles").project("name", "email").build()
    expect(result.sql).toContain("name")
    expect(result.sql).toContain("email")
  })

  it("builds sort", () => {
    const result = new DocumentQueryBuilder("profiles").sort("created_at", "desc").build()
    expect(result.sql).toContain("ORDER BY")
    expect(result.sql).toContain("DESC")
  })

  it("builds unwind", () => {
    const result = new DocumentQueryBuilder("profiles").unwind("tags").build()
    expect(result.sql).toContain("jsonb_array_elements")
    expect(result.sql).toContain("LATERAL")
  })

  it("builds limit/offset", () => {
    const result = new DocumentQueryBuilder("profiles").limit(5).offset(10).build()
    expect(result.params).toContain(5)
    expect(result.params).toContain(10)
  })

  it("supports nested paths", () => {
    const result = new DocumentQueryBuilder("profiles").match({ "address.city": "NYC" }).build()
    expect(result.sql).toContain("address")
    expect(result.sql).toContain("city")
  })
})

describe("GraphQueryBuilder", () => {
  it("builds simple node query", () => {
    const result = new GraphQueryBuilder("employees").build()
    expect(result.sql).toContain("SELECT")
    expect(result.sql).toContain('"employees"')
    expect(result.model).toBe("graph")
  })

  it("builds node query with filter", () => {
    const result = new GraphQueryBuilder("employees").startFrom({ department: "engineering" }).build()
    expect(result.sql).toContain("WHERE")
    expect(result.params).toContain("engineering")
  })

  it("builds graph traversal with recursive CTE", () => {
    const result = new GraphQueryBuilder("employees")
      .edges("reports_to", "employee_id", "manager_id")
      .startFrom({ id: "emp1" })
      .traverse("outbound", 3)
      .build()
    expect(result.sql).toContain("WITH RECURSIVE")
    expect(result.sql).toContain("graph_traversal")
    expect(result.sql).toContain("UNION ALL")
    expect(result.params).toContain("emp1")
    expect(result.params).toContain(3)
  })

  it("builds inbound traversal", () => {
    const result = new GraphQueryBuilder("employees")
      .edges("reports_to", "employee_id", "manager_id")
      .traverse("inbound", 2)
      .build()
    expect(result.sql).toContain("WITH RECURSIVE")
  })

  it("includes cycle prevention", () => {
    const result = new GraphQueryBuilder("nodes").edges("edges").traverse("outbound", 5).build()
    expect(result.sql).toContain("NOT")
    expect(result.sql).toContain("ANY(g.path)")
  })

  it("throws without edge table set", () => {
    expect(() => new GraphQueryBuilder("nodes").traverse("outbound")).toThrow("Edge table must be set")
  })

  it("builds with limit", () => {
    const result = new GraphQueryBuilder("nodes").edges("edges").traverse("outbound").limit(100).build()
    expect(result.sql).toContain("LIMIT")
    expect(result.params).toContain(100)
  })

  it("builds with select columns", () => {
    const result = new GraphQueryBuilder("employees").select("id", "name").build()
    expect(result.sql).toContain("id, name")
  })
})
