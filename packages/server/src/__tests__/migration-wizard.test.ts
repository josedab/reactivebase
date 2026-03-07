import { describe, it, expect } from "vitest"
import {
  MigrationWizard,
  discoverTrpcRoutes,
  discoverExpressRoutes,
  mapPrismaType,
  mapDrizzleType,
  analyzeFeatureGaps,
} from "../migrate-from/migration-wizard.js"

const PRISMA_SCHEMA = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

model User {
  id    String @id @default(cuid())
  name  String
  email String @unique
  posts Post[]
}

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String
  createdAt DateTime @default(now())
  @@index([authorId])
}
`

const TRPC_ROUTER = `
import { publicProcedure, createRouter } from "./trpc"

const postsRouter = createRouter({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.prisma.post.findMany()
  }),
  create: publicProcedure.input(z.object({ title: z.string() })).mutation(async ({ ctx, input }) => {
    return ctx.prisma.post.create({ data: input })
  }),
})
`

const EXPRESS_ROUTES = `
import express from "express"
const router = express.Router()

router.get("/api/users", async (req, res) => {
  const users = await db.users.findAll()
  res.json(users)
})

router.post("/api/users", async (req, res) => {
  const user = await db.users.create(req.body)
  res.json(user)
})

router.delete("/api/users/:id", async (req, res) => {
  await db.users.delete(req.params.id)
  res.sendStatus(204)
})
`

describe("MigrationWizard", () => {
  const wizard = new MigrationWizard()

  describe("analyzeProject", () => {
    it("detects Prisma projects", () => {
      const analysis = wizard.analyzeProject({ "schema.prisma": PRISMA_SCHEMA })
      expect(analysis.source).toBe("prisma")
      expect(analysis.tables.length).toBeGreaterThanOrEqual(1)
    })

    it("extracts tables from Prisma schema", () => {
      const analysis = wizard.analyzeProject({ "schema.prisma": PRISMA_SCHEMA })
      const postTable = analysis.tables.find((t) => t.name === "posts")
      expect(postTable).toBeDefined()
      expect(postTable!.fields.length).toBeGreaterThanOrEqual(2)
    })

    it("extracts relations", () => {
      const analysis = wizard.analyzeProject({ "schema.prisma": PRISMA_SCHEMA })
      const postTable = analysis.tables.find((t) => t.name === "posts")
      expect(postTable!.relations.length).toBeGreaterThanOrEqual(1)
      expect(postTable!.relations[0].toTable).toContain("user")
    })

    it("discovers tRPC routes", () => {
      const analysis = wizard.analyzeProject({
        "schema.prisma": PRISMA_SCHEMA,
        "router.ts": TRPC_ROUTER,
      })
      expect(analysis.routes.length).toBeGreaterThanOrEqual(1)
    })

    it("discovers Express routes", () => {
      const analysis = wizard.analyzeProject({
        "schema.prisma": PRISMA_SCHEMA,
        "routes.ts": EXPRESS_ROUTES,
      })
      expect(analysis.routes.length).toBeGreaterThanOrEqual(2)
    })

    it("provides statistics", () => {
      const analysis = wizard.analyzeProject({ "schema.prisma": PRISMA_SCHEMA })
      expect(analysis.stats.totalTables).toBeGreaterThanOrEqual(1)
      expect(analysis.stats.totalFields).toBeGreaterThan(0)
      expect(analysis.stats.estimatedMigrationMinutes).toBeGreaterThan(0)
    })
  })

  describe("createMigrationPlan", () => {
    it("generates a migration plan", () => {
      const analysis = wizard.analyzeProject({ "schema.prisma": PRISMA_SCHEMA })
      const plan = wizard.createMigrationPlan(analysis)
      expect(plan.steps.length).toBeGreaterThanOrEqual(1)
      expect(plan.schemaCode).toContain("defineSchema")
      expect(plan.migrationSQL).toContain("CREATE TABLE")
    })

    it("supports selective table migration", () => {
      const analysis = wizard.analyzeProject({ "schema.prisma": PRISMA_SCHEMA })
      const plan = wizard.createMigrationPlan(analysis, ["posts"])
      expect(plan.steps).toHaveLength(1)
      expect(plan.steps[0].table).toBe("posts")
    })

    it("generates rollback SQL for each step", () => {
      const analysis = wizard.analyzeProject({ "schema.prisma": PRISMA_SCHEMA })
      const plan = wizard.createMigrationPlan(analysis)
      for (const step of plan.steps) {
        expect(step.rollbackSql).toContain("DROP TABLE")
      }
    })

    it("generates function skeletons from routes", () => {
      const analysis = wizard.analyzeProject({
        "schema.prisma": PRISMA_SCHEMA,
        "routes.ts": EXPRESS_ROUTES,
      })
      const plan = wizard.createMigrationPlan(analysis)
      expect(plan.functionCode).toContain("query")
    })
  })

  describe("generateDiff", () => {
    it("produces diff for each table", () => {
      const analysis = wizard.analyzeProject({ "schema.prisma": PRISMA_SCHEMA })
      const diff = wizard.generateDiff(analysis)
      expect(diff.length).toBeGreaterThanOrEqual(1)
      expect(diff[0].changes.length).toBeGreaterThan(0)
      expect(diff[0].changes[0].type).toBe("added")
    })
  })
})

describe("mapPrismaType", () => {
  it("maps String to v.string()", () => {
    expect(mapPrismaType("String").validator).toBe("v.string()")
  })

  it("maps Int to v.integer()", () => {
    expect(mapPrismaType("Int").validator).toBe("v.integer()")
  })

  it("maps DateTime to v.timestamp()", () => {
    expect(mapPrismaType("DateTime").validator).toBe("v.timestamp()")
  })

  it("maps unknown PascalCase types with guidance note", () => {
    const result = mapPrismaType("User")
    expect(result.validator).toBe("v.string()")
    expect(result.notes).toContain("Prisma enum or model")
  })

  it("maps Unsupported types to custom validators", () => {
    const result = mapPrismaType('Unsupported("citext")')
    expect(result.validator).toContain("custom")
    expect(result.validator).toContain("citext")
    expect(result.notes).toContain("Unsupported")
  })

  it("maps Bytes to bytea custom type", () => {
    const result = mapPrismaType("Bytes")
    expect(result.validator).toContain("bytea")
  })
})

describe("mapDrizzleType", () => {
  it("maps text to v.string()", () => {
    expect(mapDrizzleType("text").validator).toBe("v.string()")
  })

  it("maps integer to v.integer()", () => {
    expect(mapDrizzleType("integer").validator).toBe("v.integer()")
  })

  it("maps unknown types as custom", () => {
    const result = mapDrizzleType("citext")
    expect(result.validator).toContain("custom")
  })
})

describe("discoverTrpcRoutes", () => {
  it("discovers tRPC query procedures", () => {
    const routes = discoverTrpcRoutes(TRPC_ROUTER, "router.ts")
    expect(routes.length).toBeGreaterThanOrEqual(1)
  })
})

describe("discoverExpressRoutes", () => {
  it("discovers Express GET routes as queries", () => {
    const routes = discoverExpressRoutes(EXPRESS_ROUTES, "routes.ts")
    const getRoutes = routes.filter((r) => r.method === "GET")
    expect(getRoutes.length).toBeGreaterThanOrEqual(1)
    expect(getRoutes[0].suggestedType).toBe("query")
  })

  it("discovers Express POST routes as mutations", () => {
    const routes = discoverExpressRoutes(EXPRESS_ROUTES, "routes.ts")
    const postRoutes = routes.filter((r) => r.method === "POST")
    expect(postRoutes.length).toBeGreaterThanOrEqual(1)
    expect(postRoutes[0].suggestedType).toBe("mutation")
  })

  it("generates function skeletons", () => {
    const routes = discoverExpressRoutes(EXPRESS_ROUTES, "routes.ts")
    for (const route of routes) {
      expect(route.skeleton).toContain("export const")
    }
  })
})

describe("analyzeFeatureGaps", () => {
  it("reports Prisma feature gaps", () => {
    const gaps = analyzeFeatureGaps("prisma")
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps.some((g) => g.feature === "Reactive queries")).toBe(true)
    const multiProvider = gaps.find((g) => g.feature.includes("Multi-provider"))
    expect(multiProvider?.available).toBe(false)
  })

  it("reports Drizzle feature gaps", () => {
    const gaps = analyzeFeatureGaps("drizzle")
    expect(gaps.length).toBeGreaterThan(0)
  })
})
