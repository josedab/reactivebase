import { describe, it, expect, beforeEach } from "vitest"
import {
  generateFederatedSchema,
  generateResolverSkeleton,
  getSubscriptionMappings,
} from "../api-gen/federation.js"
import type { Schema } from "../schema/index.js"

// Mock schema for testing
const mockSchema: Schema = {
  tableNames: ["tasks", "users"],
  tables: {
    tasks: {
      columns: {
        title: { type: "string", isOptional: false },
        done: { type: "boolean", isOptional: false },
        priority: { type: "enum", isOptional: false },
        assigneeId: { type: "id", isOptional: false },
        dueDate: { type: "timestamp", isOptional: true },
      },
      indexes: [],
      relations: [],
    },
    users: {
      columns: {
        name: { type: "string", isOptional: false },
        email: { type: "string", isOptional: false },
        role: { type: "enum", isOptional: false },
      },
      indexes: [],
      relations: [],
    },
  },
} as unknown as Schema

describe("generateFederatedSchema", () => {
  it("generates a valid GraphQL schema", () => {
    const result = generateFederatedSchema(mockSchema)
    expect(result.sdl).toContain("type Tasks")
    expect(result.sdl).toContain("type Users")
    expect(result.sdl).toContain("type Query")
    expect(result.sdl).toContain("type Mutation")
  })

  it("includes Federation v2 directives by default", () => {
    const result = generateFederatedSchema(mockSchema)
    expect(result.sdl).toContain("@link(url:")
    expect(result.sdl).toContain('@key(fields: "id")')
    expect(result.sdl).toContain("_entities")
    expect(result.sdl).toContain("_Entity")
    expect(result.sdl).toContain("_Service")
  })

  it("can disable federation", () => {
    const result = generateFederatedSchema(mockSchema, { federation: false })
    expect(result.sdl).not.toContain("@key")
    expect(result.sdl).not.toContain("_entities")
  })

  it("generates Relay pagination types by default", () => {
    const result = generateFederatedSchema(mockSchema)
    expect(result.sdl).toContain("PageInfo")
    expect(result.sdl).toContain("TasksEdge")
    expect(result.sdl).toContain("TasksConnection")
    expect(result.sdl).toContain("totalCount")
  })

  it("can disable Relay pagination", () => {
    const result = generateFederatedSchema(mockSchema, { relayPagination: false })
    expect(result.sdl).not.toContain("PageInfo")
    expect(result.sdl).not.toContain("Connection")
  })

  it("generates subscription types by default", () => {
    const result = generateFederatedSchema(mockSchema)
    expect(result.sdl).toContain("type Subscription")
    expect(result.sdl).toContain("onTasksChanged")
    expect(result.sdl).toContain("onUsersChanged")
  })

  it("maps subscription fields to tables", () => {
    const result = generateFederatedSchema(mockSchema)
    expect(result.subscriptionMappings.onTasksChanged).toBe("tasks")
    expect(result.subscriptionMappings.onUsersChanged).toBe("users")
  })

  it("tracks entity types", () => {
    const result = generateFederatedSchema(mockSchema)
    expect(result.entityTypes).toContain("Tasks")
    expect(result.entityTypes).toContain("Users")
  })

  it("generates input types for mutations", () => {
    const result = generateFederatedSchema(mockSchema)
    expect(result.sdl).toContain("input TasksInput")
    expect(result.sdl).toContain("input UsersInput")
    expect(result.sdl).toContain("createTasks(input: TasksInput!)")
    expect(result.sdl).toContain("updateTasks(id: ID!, input: TasksInput!)")
    expect(result.sdl).toContain("deleteTasks(id: ID!): Boolean!")
  })

  it("maps validator types correctly", () => {
    const result = generateFederatedSchema(mockSchema)
    expect(result.sdl).toContain("title: String!")
    expect(result.sdl).toContain("done: Boolean!")
  })

  it("generates custom scalars", () => {
    const result = generateFederatedSchema(mockSchema)
    expect(result.sdl).toContain("scalar DateTime")
    expect(result.sdl).toContain("scalar JSON")
  })
})

describe("generateResolverSkeleton", () => {
  it("generates resolver code for all tables", () => {
    const code = generateResolverSkeleton(mockSchema)
    expect(code).toContain("Query")
    expect(code).toContain("Mutation")
    expect(code).toContain("tasks:")
    expect(code).toContain("users:")
    expect(code).toContain("createTasks:")
    expect(code).toContain("updateTasks:")
    expect(code).toContain("deleteTasks:")
  })
})

describe("getSubscriptionMappings", () => {
  it("generates mappings for all tables", () => {
    const mappings = getSubscriptionMappings(mockSchema)
    expect(mappings).toHaveLength(2)
    expect(mappings[0].subscriptionField).toBe("onTasksChanged")
    expect(mappings[0].tableName).toBe("tasks")
    expect(mappings[1].subscriptionField).toBe("onUsersChanged")
    expect(mappings[1].tableName).toBe("users")
  })
})
