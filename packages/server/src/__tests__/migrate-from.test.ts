import { describe, it, expect } from "vitest"
import { parsePrismaSchema, convertPrismaToReactiveBase } from "../migrate-from/prisma.js"
import { parseDrizzleSchema, convertDrizzleToReactiveBase } from "../migrate-from/drizzle.js"

const PRISMA_SCHEMA = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  role      String   @default("member")
  createdAt DateTime @default(now())
  posts     Post[]
}

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  tags      String[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([authorId])
  @@index([published, createdAt])
}
`

describe("Prisma schema parser", () => {
  it("parses models from Prisma schema", () => {
    const models = parsePrismaSchema(PRISMA_SCHEMA)
    expect(models).toHaveLength(2)
    expect(models[0].name).toBe("User")
    expect(models[1].name).toBe("Post")
  })

  it("parses field types correctly", () => {
    const models = parsePrismaSchema(PRISMA_SCHEMA)
    const user = models[0]

    const emailField = user.fields.find((f) => f.name === "email")
    expect(emailField?.type).toBe("String")
    expect(emailField?.isUnique).toBe(true)

    const nameField = user.fields.find((f) => f.name === "name")
    expect(nameField?.isOptional).toBe(true)

    const createdAt = user.fields.find((f) => f.name === "createdAt")
    expect(createdAt?.default).toBe("now()")
  })

  it("skips @id fields", () => {
    const models = parsePrismaSchema(PRISMA_SCHEMA)
    const user = models[0]
    const idField = user.fields.find((f) => f.isId)
    // id field exists in parsed fields but should be skipped in generation
    expect(idField).toBeDefined()
  })

  it("parses @@index definitions", () => {
    const models = parsePrismaSchema(PRISMA_SCHEMA)
    const post = models[1]
    expect(post.indexes).toHaveLength(2)
    expect(post.indexes[0].fields).toEqual(["authorId"])
    expect(post.indexes[1].fields).toEqual(["published", "createdAt"])
  })
})

describe("Prisma to ReactiveBase conversion", () => {
  it("generates valid ReactiveBase schema code", () => {
    const output = convertPrismaToReactiveBase(PRISMA_SCHEMA)

    expect(output).toContain("import { defineSchema, defineTable, v }")
    expect(output).toContain("defineSchema({")
    expect(output).toContain("user: defineTable({")
    expect(output).toContain("post: defineTable({")

    // Type mappings
    expect(output).toContain("v.string()")
    expect(output).toContain("v.optional(v.string())")
    expect(output).toContain("v.boolean({ default: false })")
    expect(output).toContain('v.timestamp({ default: "now" })')

    // Indexes
    expect(output).toContain(".index(")
    expect(output).toContain("{ unique: true }")
  })

  it("maps Prisma types correctly", () => {
    const simple = `
model Item {
  id      String   @id
  count   Int
  price   Float
  active  Boolean  @default(true)
  data    Json
  created DateTime @default(now())
}
`
    const output = convertPrismaToReactiveBase(simple)
    expect(output).toContain("v.integer()")
    expect(output).toContain("v.number()")
    expect(output).toContain("v.boolean({ default: true })")
    expect(output).toContain("v.json()")
    expect(output).toContain('v.timestamp({ default: "now" })')
  })
})

const DRIZZLE_SCHEMA = `
import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core"

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  age: integer("age"),
  active: boolean("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
})

export const posts = pgTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  authorId: text("authorId").notNull(),
})
`

describe("Drizzle schema parser", () => {
  it("parses table definitions", () => {
    const tables = parseDrizzleSchema(DRIZZLE_SCHEMA)
    expect(tables).toHaveLength(2)
    expect(tables[0].name).toBe("users")
    expect(tables[1].name).toBe("posts")
  })

  it("parses column types and modifiers", () => {
    const tables = parseDrizzleSchema(DRIZZLE_SCHEMA)
    const users = tables[0]

    const nameCol = users.columns.find((c) => c.name === "name")
    expect(nameCol?.type).toBe("text")
    expect(nameCol?.isNotNull).toBe(true)

    const ageCol = users.columns.find((c) => c.name === "age")
    expect(ageCol?.isNotNull).toBe(false)
  })
})

describe("Drizzle to ReactiveBase conversion", () => {
  it("generates valid schema code", () => {
    const output = convertDrizzleToReactiveBase(DRIZZLE_SCHEMA)

    expect(output).toContain("defineSchema({")
    expect(output).toContain("users: defineTable({")
    expect(output).toContain("posts: defineTable({")
    expect(output).toContain("v.string()")
    expect(output).toContain("v.optional(v.integer())")
    expect(output).toContain('v.timestamp({ default: "now" })')
  })
})
