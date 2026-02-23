import { describe, it, expect, beforeEach } from "vitest"
import { GraphQLSubscriptionGateway, GraphQLGatewayError } from "../src/index.js"

// Minimal schema fixture matching SchemaLike interface
function createTestSchema() {
  return {
    tableNames: ["tasks", "users"],
    tables: {
      tasks: {
        columns: {
          title: { type: "string", isOptional: false, pgType: "text", options: {} },
          completed: { type: "boolean", isOptional: false, pgType: "boolean", options: { default: false } },
          priority: { type: "integer", isOptional: false, pgType: "integer", options: {} },
        },
      },
      users: {
        columns: {
          name: { type: "string", isOptional: false, pgType: "text", options: {} },
          email: { type: "string", isOptional: false, pgType: "text", options: {} },
          role: { type: "enum", isOptional: false, pgType: "text", options: {}, enumValues: ["admin", "user"] },
        },
      },
    },
  }
}

const schema = createTestSchema()

describe("GraphQLSubscriptionGateway", () => {
  let gateway: GraphQLSubscriptionGateway

  beforeEach(() => {
    gateway = new GraphQLSubscriptionGateway({ schema })
  })

  describe("schema generation", () => {
    it("should generate SDL with types for all tables", () => {
      const result = gateway.generateSchema()
      expect(result.sdl).toContain("type Tasks {")
      expect(result.sdl).toContain("type Users {")
      expect(result.sdl).toContain("id: ID!")
      expect(result.sdl).toContain("title: String!")
      expect(result.sdl).toContain("email: String!")
    })

    it("should generate input types", () => {
      const result = gateway.generateSchema()
      expect(result.sdl).toContain("input TasksInput {")
      expect(result.sdl).toContain("input UsersInput {")
    })

    it("should generate query types", () => {
      const result = gateway.generateSchema()
      expect(result.sdl).toContain("type Query {")
      expect(result.sdl).toContain("tasks(")
      expect(result.sdl).toContain("user(id: ID!): Users")
    })

    it("should generate mutation types", () => {
      const result = gateway.generateSchema()
      expect(result.sdl).toContain("type Mutation {")
      expect(result.sdl).toContain("createTasks(")
      expect(result.sdl).toContain("updateUsers(")
      expect(result.sdl).toContain("deleteTasks(")
    })

    it("should generate subscription types", () => {
      const result = gateway.generateSchema()
      expect(result.sdl).toContain("type Subscription {")
      expect(result.sdl).toContain("onTasksChanged(")
      expect(result.sdl).toContain("onUsersChanged(")
    })

    it("should generate Relay pagination types by default", () => {
      const result = gateway.generateSchema()
      expect(result.sdl).toContain("type TasksEdge {")
      expect(result.sdl).toContain("type TasksConnection {")
      expect(result.sdl).toContain("type PageInfo {")
    })

    it("should generate subscription mappings", () => {
      const result = gateway.generateSchema()
      expect(result.subscriptionMappings["onTasksChanged"]).toEqual({
        field: "onTasksChanged",
        tableName: "tasks",
        queryName: "tasks.list",
        filterInputType: "TasksWhereInput",
      })
    })

    it("should skip subscriptions when disabled", () => {
      const gw = new GraphQLSubscriptionGateway({ schema, subscriptions: false })
      const result = gw.generateSchema()
      expect(result.sdl).not.toContain("type Subscription {")
      expect(result.subscriptionFields).toHaveLength(0)
    })

    it("should cache generated schema", () => {
      const result1 = gateway.generateSchema()
      const result2 = gateway.generateSchema()
      expect(result1).toBe(result2)
    })
  })

  describe("operation parsing", () => {
    it("should parse query operations", () => {
      const parsed = gateway.parseOperation({ query: "{ tasks { id title } }" })
      expect(parsed.type).toBe("query")
      expect(parsed.rootField).toBe("tasks")
    })

    it("should parse mutation operations", () => {
      const parsed = gateway.parseOperation({
        query: 'mutation { createTasks(input: { title: "Test" }) { id } }',
      })
      expect(parsed.type).toBe("mutation")
      expect(parsed.rootField).toBe("createTasks")
    })

    it("should parse subscription operations", () => {
      const parsed = gateway.parseOperation({
        query: "subscription { onTasksChanged { id title } }",
      })
      expect(parsed.type).toBe("subscription")
      expect(parsed.rootField).toBe("onTasksChanged")
    })

    it("should parse variables", () => {
      const parsed = gateway.parseOperation({
        query: "query GetTask($id: ID!) { task(id: $id) { id } }",
        variables: { id: "123" },
      })
      expect(parsed.variables).toEqual({ id: "123" })
      expect(parsed.variableRefs).toContain("id")
    })
  })

  describe("subscriptions", () => {
    it("should create and manage subscriptions", () => {
      gateway.generateSchema()
      const handle = gateway.subscribe("sub-1", "onTasksChanged")
      expect(handle.id).toBe("sub-1")
      expect(handle.field).toBe("onTasksChanged")
      expect(handle.tableName).toBe("tasks")
      expect(gateway.subscriptionCount).toBe(1)
    })

    it("should deliver data to subscription listeners", () => {
      gateway.generateSchema()
      const handle = gateway.subscribe("sub-1", "onTasksChanged")

      const received: unknown[] = []
      handle.onData((event) => received.push(event.data))

      gateway.pushSubscriptionData("sub-1", { id: "1", title: "Test" })
      expect(received).toHaveLength(1)
      expect(received[0]).toEqual({ id: "1", title: "Test" })
    })

    it("should unsubscribe correctly", () => {
      gateway.generateSchema()
      const handle = gateway.subscribe("sub-1", "onTasksChanged")
      handle.unsubscribe()
      expect(gateway.subscriptionCount).toBe(0)
    })

    it("should throw on unknown subscription field", () => {
      gateway.generateSchema()
      expect(() => gateway.subscribe("sub-1", "onUnknown")).toThrow(GraphQLGatewayError)
    })

    it("should find subscriptions for a table", () => {
      gateway.generateSchema()
      gateway.subscribe("sub-1", "onTasksChanged")
      gateway.subscribe("sub-2", "onUsersChanged")
      gateway.subscribe("sub-3", "onTasksList")

      const taskSubs = gateway.getSubscriptionsForTable("tasks")
      expect(taskSubs).toContain("sub-1")
      expect(taskSubs).toContain("sub-3")
      expect(taskSubs).not.toContain("sub-2")
    })
  })

  describe("transport protocol", () => {
    it("should handle connection_init", () => {
      const responses = gateway.handleTransportMessage({ type: "connection_init" })
      expect(responses).toHaveLength(1)
      expect(responses[0].type).toBe("connection_ack")
    })

    it("should handle subscribe messages", () => {
      gateway.generateSchema()
      const responses = gateway.handleTransportMessage({
        id: "sub-1",
        type: "subscribe",
        payload: { query: "subscription { onTasksChanged { id } }" },
      })
      expect(responses).toHaveLength(0) // No error = implicit ack
      expect(gateway.subscriptionCount).toBe(1)
    })

    it("should handle complete messages", () => {
      gateway.generateSchema()
      gateway.subscribe("sub-1", "onTasksChanged")
      const responses = gateway.handleTransportMessage({ id: "sub-1", type: "complete" })
      expect(responses[0].type).toBe("complete")
      expect(gateway.subscriptionCount).toBe(0)
    })

    it("should reject non-subscription operations via subscribe message", () => {
      const responses = gateway.handleTransportMessage({
        id: "sub-1",
        type: "subscribe",
        payload: { query: "{ tasks { id } }" },
      })
      expect(responses).toHaveLength(1)
      expect(responses[0].type).toBe("error")
    })
  })

  describe("client config generation", () => {
    it("should generate Apollo client config", () => {
      const config = gateway.generateApolloClientConfig("ws://localhost:4000/graphql")
      expect(config).toContain("ApolloClient")
      expect(config).toContain("ws://localhost:4000/graphql")
      expect(config).toContain("http://localhost:4000/graphql")
    })

    it("should generate urql client config", () => {
      const config = gateway.generateUrqlClientConfig("ws://localhost:4000/graphql")
      expect(config).toContain("createClient")
      expect(config).toContain("subscriptionExchange")
    })
  })

  describe("type generation", () => {
    it("should generate TypeScript interfaces", () => {
      const types = gateway.generateTypeDefinitions()
      expect(types).toContain("export interface Tasks {")
      expect(types).toContain("title: string;")
      expect(types).toContain("completed: boolean;")
      expect(types).toContain("priority: number;")
    })
  })

  describe("cleanup", () => {
    it("should destroy gateway and clean up subscriptions", () => {
      gateway.generateSchema()
      gateway.subscribe("sub-1", "onTasksChanged")
      gateway.subscribe("sub-2", "onUsersChanged")

      gateway.destroy()
      expect(gateway.subscriptionCount).toBe(0)
    })
  })
})
