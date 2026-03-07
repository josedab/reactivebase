import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  GraphQLSubscriptionGateway,
  GraphQLGatewayError,
  type GraphQLGatewayOptions,
  type SubscriptionTransportMessage,
} from "../graphql-gateway.js"

// ── Mock Schema ──────────────────────────────────────────────────────────────

function makeSchema() {
  return {
    tableNames: ["users", "tasks"],
    tables: {
      users: {
        columns: {
          name: { type: "string", isOptional: false },
          email: { type: "string", isOptional: false },
          role: { type: "enum", isOptional: true },
        },
      },
      tasks: {
        columns: {
          title: { type: "string", isOptional: false },
          done: { type: "boolean", isOptional: true },
          assigneeId: { type: "id", isOptional: true },
        },
      },
    },
  } as const
}

function makeGateway(overrides: Partial<GraphQLGatewayOptions> = {}) {
  return new GraphQLSubscriptionGateway({ schema: makeSchema(), ...overrides })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GraphQLSubscriptionGateway", () => {
  let gw: GraphQLSubscriptionGateway

  beforeEach(() => {
    gw = makeGateway()
  })

  afterEach(() => {
    gw.destroy()
  })

  // ── Constructor & Defaults ───────────────────────────────────────────────

  describe("constructor & defaults", () => {
    it("uses default basePath /graphql", () => {
      expect(gw.basePath).toBe("/graphql")
    })

    it("respects custom basePath", () => {
      const custom = makeGateway({ basePath: "/api/gql" })
      expect(custom.basePath).toBe("/api/gql")
      custom.destroy()
    })

    it("starts with zero subscriptions", () => {
      expect(gw.subscriptionCount).toBe(0)
    })
  })

  // ── Schema Generation ────────────────────────────────────────────────────

  describe("generateSchema()", () => {
    it("returns an object with sdl, types, queryFields, mutationFields, subscriptionFields", () => {
      const schema = gw.generateSchema()
      expect(schema).toHaveProperty("sdl")
      expect(schema).toHaveProperty("types")
      expect(schema).toHaveProperty("queryFields")
      expect(schema).toHaveProperty("mutationFields")
      expect(schema).toHaveProperty("subscriptionFields")
      expect(schema).toHaveProperty("subscriptionMappings")
    })

    it("caches the generated schema on subsequent calls", () => {
      const first = gw.generateSchema()
      const second = gw.generateSchema()
      expect(first).toBe(second)
    })

    // ── Types ──────────────────────────────────────────────────────────────

    describe("types", () => {
      it("generates OBJECT types for each table", () => {
        const { types } = gw.generateSchema()
        const objectTypes = types.filter((t) => t.kind === "OBJECT")
        const names = objectTypes.map((t) => t.name)
        expect(names).toContain("Users")
        expect(names).toContain("Tasks")
      })

      it("generates INPUT_OBJECT types for each table", () => {
        const { types } = gw.generateSchema()
        const inputTypes = types.filter((t) => t.kind === "INPUT_OBJECT")
        const names = inputTypes.map((t) => t.name)
        expect(names).toContain("UsersInput")
        expect(names).toContain("TasksInput")
      })

      it("includes id field in OBJECT types", () => {
        const { types } = gw.generateSchema()
        const usersType = types.find((t) => t.name === "Users" && t.kind === "OBJECT")!
        const idField = usersType.fields.find((f) => f.name === "id")
        expect(idField).toBeDefined()
        expect(idField!.type).toBe("ID!")
      })

      it("maps string columns correctly", () => {
        const { types } = gw.generateSchema()
        const usersType = types.find((t) => t.name === "Users" && t.kind === "OBJECT")!
        const nameField = usersType.fields.find((f) => f.name === "name")
        expect(nameField!.type).toBe("String!")
      })

      it("maps boolean columns correctly", () => {
        const { types } = gw.generateSchema()
        const tasksType = types.find((t) => t.name === "Tasks" && t.kind === "OBJECT")!
        const doneField = tasksType.fields.find((f) => f.name === "done")
        expect(doneField!.type).toBe("Boolean")
      })

      it("maps optional fields without !", () => {
        const { types } = gw.generateSchema()
        const usersType = types.find((t) => t.name === "Users" && t.kind === "OBJECT")!
        const roleField = usersType.fields.find((f) => f.name === "role")
        expect(roleField!.type).not.toContain("!")
      })

      it("maps id type to String", () => {
        const { types } = gw.generateSchema()
        const tasksType = types.find((t) => t.name === "Tasks" && t.kind === "OBJECT")!
        const assigneeField = tasksType.fields.find((f) => f.name === "assigneeId")
        expect(assigneeField!.type).toBe("String")
      })

      it("input types strip ! from field types", () => {
        const { types } = gw.generateSchema()
        const usersInput = types.find((t) => t.name === "UsersInput" && t.kind === "INPUT_OBJECT")!
        for (const field of usersInput.fields) {
          expect(field.type).not.toContain("!")
        }
      })
    })

    // ── Query Fields ───────────────────────────────────────────────────────

    describe("queryFields", () => {
      it("generates list query for each table", () => {
        const { queryFields } = gw.generateSchema()
        const names = queryFields.map((f) => f.name)
        expect(names).toContain("users")
        expect(names).toContain("tasks")
      })

      it("generates singular query for each table", () => {
        const { queryFields } = gw.generateSchema()
        const names = queryFields.map((f) => f.name)
        expect(names).toContain("user")
        expect(names).toContain("task")
      })

      it("singular query takes id: ID! argument", () => {
        const { queryFields } = gw.generateSchema()
        const userQuery = queryFields.find((f) => f.name === "user")!
        expect(userQuery.args).toEqual([{ name: "id", type: "ID!" }])
      })

      it("list query with relay pagination returns Connection type", () => {
        const { queryFields } = gw.generateSchema()
        const usersQuery = queryFields.find((f) => f.name === "users")!
        expect(usersQuery.type).toBe("UsersConnection!")
      })

      it("list query without relay pagination returns array type", () => {
        const noRelay = makeGateway({ relayPagination: false })
        const { queryFields } = noRelay.generateSchema()
        const usersQuery = queryFields.find((f) => f.name === "users")!
        expect(usersQuery.type).toBe("[Users!]!")
        noRelay.destroy()
      })

      it("list query with relay pagination has first/after/last/before/where args", () => {
        const { queryFields } = gw.generateSchema()
        const usersQuery = queryFields.find((f) => f.name === "users")!
        const argNames = usersQuery.args.map((a) => a.name)
        expect(argNames).toEqual(expect.arrayContaining(["first", "after", "last", "before", "where"]))
      })

      it("list query without relay pagination has limit/offset/where args", () => {
        const noRelay = makeGateway({ relayPagination: false })
        const { queryFields } = noRelay.generateSchema()
        const usersQuery = queryFields.find((f) => f.name === "users")!
        const argNames = usersQuery.args.map((a) => a.name)
        expect(argNames).toEqual(expect.arrayContaining(["limit", "offset", "where"]))
        noRelay.destroy()
      })
    })

    // ── Mutation Fields ────────────────────────────────────────────────────

    describe("mutationFields", () => {
      it("generates create, update, delete mutations for each table", () => {
        const { mutationFields } = gw.generateSchema()
        const names = mutationFields.map((f) => f.name)
        expect(names).toContain("createUsers")
        expect(names).toContain("updateUsers")
        expect(names).toContain("deleteUsers")
        expect(names).toContain("createTasks")
        expect(names).toContain("updateTasks")
        expect(names).toContain("deleteTasks")
      })

      it("create mutation takes input arg and returns type", () => {
        const { mutationFields } = gw.generateSchema()
        const create = mutationFields.find((f) => f.name === "createUsers")!
        expect(create.type).toBe("Users!")
        expect(create.args).toEqual([{ name: "input", type: "UsersInput!" }])
      })

      it("update mutation takes id and input args", () => {
        const { mutationFields } = gw.generateSchema()
        const update = mutationFields.find((f) => f.name === "updateUsers")!
        expect(update.type).toBe("Users!")
        const argNames = update.args.map((a) => a.name)
        expect(argNames).toEqual(["id", "input"])
      })

      it("delete mutation takes id and returns Boolean!", () => {
        const { mutationFields } = gw.generateSchema()
        const del = mutationFields.find((f) => f.name === "deleteUsers")!
        expect(del.type).toBe("Boolean!")
        expect(del.args).toEqual([{ name: "id", type: "ID!" }])
      })
    })

    // ── Subscription Fields ────────────────────────────────────────────────

    describe("subscriptionFields", () => {
      it("generates onChanged and onList subscriptions for each table", () => {
        const { subscriptionFields } = gw.generateSchema()
        const names = subscriptionFields.map((f) => f.name)
        expect(names).toContain("onUsersChanged")
        expect(names).toContain("onUsersList")
        expect(names).toContain("onTasksChanged")
        expect(names).toContain("onTasksList")
      })

      it("onChanged subscription returns single type", () => {
        const { subscriptionFields } = gw.generateSchema()
        const sub = subscriptionFields.find((f) => f.name === "onUsersChanged")!
        expect(sub.type).toBe("Users!")
      })

      it("onList subscription returns array type", () => {
        const { subscriptionFields } = gw.generateSchema()
        const sub = subscriptionFields.find((f) => f.name === "onUsersList")!
        expect(sub.type).toBe("[Users!]!")
      })

      it("subscriptions have description", () => {
        const { subscriptionFields } = gw.generateSchema()
        const sub = subscriptionFields.find((f) => f.name === "onUsersChanged")!
        expect(sub.description).toBeDefined()
        expect(sub.description).toContain("users")
      })

      it("generates no subscription fields when subscriptions disabled", () => {
        const noSubs = makeGateway({ subscriptions: false })
        const { subscriptionFields } = noSubs.generateSchema()
        expect(subscriptionFields).toHaveLength(0)
        noSubs.destroy()
      })

      it("produces subscriptionMappings with table and field info", () => {
        const { subscriptionMappings } = gw.generateSchema()
        expect(subscriptionMappings).toHaveProperty("onUsersChanged")
        expect(subscriptionMappings.onUsersChanged.tableName).toBe("users")
        expect(subscriptionMappings.onUsersChanged.field).toBe("onUsersChanged")
      })
    })
  })

  // ── SDL Output ───────────────────────────────────────────────────────────

  describe("SDL output", () => {
    it("contains type definitions for each table", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("type Users {")
      expect(sdl).toContain("type Tasks {")
    })

    it("contains input types", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("input UsersInput {")
      expect(sdl).toContain("input TasksInput {")
    })

    it("contains where input types", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("input UsersWhereInput {")
      expect(sdl).toContain("input TasksWhereInput {")
    })

    it("contains Query type", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("type Query {")
    })

    it("contains Mutation type", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("type Mutation {")
    })

    it("contains Subscription type when enabled", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("type Subscription {")
    })

    it("omits Subscription type when disabled", () => {
      const noSubs = makeGateway({ subscriptions: false })
      const { sdl } = noSubs.generateSchema()
      expect(sdl).not.toContain("type Subscription {")
      noSubs.destroy()
    })

    it("declares built-in scalars", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("scalar DateTime")
      expect(sdl).toContain("scalar JSON")
    })

    it("includes id: ID! in type definitions", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toMatch(/type Users \{[\s\S]*?id: ID!/)
    })

    it("includes CRUD mutations in SDL", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("createUsers(input: UsersInput!): Users!")
      expect(sdl).toContain("updateUsers(id: ID!, input: UsersInput!): Users!")
      expect(sdl).toContain("deleteUsers(id: ID!): Boolean!")
    })
  })

  // ── Relay Pagination ─────────────────────────────────────────────────────

  describe("Relay pagination", () => {
    it("generates Edge and Connection types when enabled (default)", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("type UsersEdge {")
      expect(sdl).toContain("type UsersConnection {")
      expect(sdl).toContain("type TasksEdge {")
      expect(sdl).toContain("type TasksConnection {")
    })

    it("generates PageInfo type when enabled", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("type PageInfo {")
      expect(sdl).toContain("hasNextPage: Boolean!")
      expect(sdl).toContain("hasPreviousPage: Boolean!")
      expect(sdl).toContain("startCursor: String")
      expect(sdl).toContain("endCursor: String")
    })

    it("Edge type contains cursor and node", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("cursor: String!")
      expect(sdl).toContain("node: Users!")
    })

    it("Connection type contains edges, pageInfo, totalCount", () => {
      const { sdl } = gw.generateSchema()
      expect(sdl).toContain("edges: [UsersEdge!]!")
      expect(sdl).toContain("pageInfo: PageInfo!")
      expect(sdl).toContain("totalCount: Int!")
    })

    it("does not generate Edge/Connection/PageInfo when relay disabled", () => {
      const noRelay = makeGateway({ relayPagination: false })
      const { sdl } = noRelay.generateSchema()
      expect(sdl).not.toContain("type UsersEdge {")
      expect(sdl).not.toContain("type UsersConnection {")
      expect(sdl).not.toContain("type PageInfo {")
      noRelay.destroy()
    })
  })

  // ── Operation Parsing ────────────────────────────────────────────────────

  describe("parseOperation()", () => {
    it("detects query operations", () => {
      const result = gw.parseOperation({ query: "query { users { id name } }" })
      expect(result.type).toBe("query")
    })

    it("detects mutation operations", () => {
      const result = gw.parseOperation({ query: "mutation { createUsers(input: {}) { id } }" })
      expect(result.type).toBe("mutation")
    })

    it("detects subscription operations", () => {
      const result = gw.parseOperation({ query: "subscription { onUsersChanged { id name } }" })
      expect(result.type).toBe("subscription")
    })

    it("defaults to query for unrecognized prefix", () => {
      const result = gw.parseOperation({ query: "{ users { id } }" })
      expect(result.type).toBe("query")
    })

    it("extracts rootField name", () => {
      const result = gw.parseOperation({ query: "query { users { id name } }" })
      expect(result.rootField).toBe("users")
    })

    it("extracts rootField from mutation", () => {
      const result = gw.parseOperation({
        query: 'mutation { createUsers(input: { name: "test" }) { id } }',
      })
      expect(result.rootField).toBe("createUsers")
    })

    it("preserves variables from request", () => {
      const variables = { id: "123" }
      const result = gw.parseOperation({
        query: "query ($id: ID!) { user(id: $id) { name } }",
        variables,
      })
      expect(result.variables).toEqual(variables)
    })

    it("defaults variables to empty object when not provided", () => {
      const result = gw.parseOperation({ query: "{ users { id } }" })
      expect(result.variables).toEqual({})
    })

    it("extracts variable references from query string", () => {
      const result = gw.parseOperation({
        query: "query ($id: ID!, $name: String) { user(id: $id) { name } }",
      })
      expect(result.variableRefs).toContain("id")
      expect(result.variableRefs).toContain("name")
    })

    it("preserves operationName when provided", () => {
      const result = gw.parseOperation({
        query: "query GetUser { user(id: 1) { name } }",
        operationName: "GetUser",
      })
      expect(result.operationName).toBe("GetUser")
    })

    it("operationName defaults to null", () => {
      const result = gw.parseOperation({ query: "{ users { id } }" })
      expect(result.operationName).toBeNull()
    })

    it("preserves raw query", () => {
      const query = "query { users { id name } }"
      const result = gw.parseOperation({ query })
      expect(result.raw).toBe(query)
    })
  })

  // ── Subscription Lifecycle ───────────────────────────────────────────────

  describe("subscription lifecycle", () => {
    it("subscribe() returns a SubscriptionHandle", () => {
      gw.generateSchema()
      const handle = gw.subscribe("sub-1", "onUsersChanged")
      expect(handle.id).toBe("sub-1")
      expect(handle.field).toBe("onUsersChanged")
      expect(handle.tableName).toBe("users")
      expect(typeof handle.unsubscribe).toBe("function")
      expect(typeof handle.onData).toBe("function")
    })

    it("increments subscriptionCount on subscribe", () => {
      gw.generateSchema()
      expect(gw.subscriptionCount).toBe(0)
      gw.subscribe("sub-1", "onUsersChanged")
      expect(gw.subscriptionCount).toBe(1)
      gw.subscribe("sub-2", "onTasksChanged")
      expect(gw.subscriptionCount).toBe(2)
    })

    it("unsubscribe() removes the subscription", () => {
      gw.generateSchema()
      gw.subscribe("sub-1", "onUsersChanged")
      expect(gw.subscriptionCount).toBe(1)
      gw.unsubscribe("sub-1")
      expect(gw.subscriptionCount).toBe(0)
    })

    it("handle.unsubscribe() also removes subscription", () => {
      gw.generateSchema()
      const handle = gw.subscribe("sub-1", "onUsersChanged")
      expect(gw.subscriptionCount).toBe(1)
      handle.unsubscribe()
      expect(gw.subscriptionCount).toBe(0)
    })

    it("unsubscribing unknown id is a no-op", () => {
      expect(() => gw.unsubscribe("nonexistent")).not.toThrow()
    })

    it("subscribe passes variables to state", () => {
      gw.generateSchema()
      const vars = { where: { role: "admin" } }
      const handle = gw.subscribe("sub-1", "onUsersChanged", vars)
      expect(handle).toBeDefined()
    })

    it("pushSubscriptionData delivers data to onData listener", () => {
      gw.generateSchema()
      const handle = gw.subscribe("sub-1", "onUsersChanged")
      const received: unknown[] = []
      handle.onData((event) => received.push(event))

      const data = { id: "u1", name: "Alice", email: "a@b.c" }
      gw.pushSubscriptionData("sub-1", data)

      expect(received).toHaveLength(1)
      expect(received[0]).toMatchObject({
        subscriptionId: "sub-1",
        field: "onUsersChanged",
        data,
      })
    })

    it("pushSubscriptionData does nothing for unknown subscription", () => {
      expect(() => gw.pushSubscriptionData("nonexistent", {})).not.toThrow()
    })

    it("pushSubscriptionData does nothing after unsubscribe", () => {
      gw.generateSchema()
      const handle = gw.subscribe("sub-1", "onUsersChanged")
      const received: unknown[] = []
      handle.onData((event) => received.push(event))

      gw.unsubscribe("sub-1")
      gw.pushSubscriptionData("sub-1", { id: "u1" })

      expect(received).toHaveLength(0)
    })

    it("multiple listeners receive the same event", () => {
      gw.generateSchema()
      const handle = gw.subscribe("sub-1", "onUsersChanged")
      const results1: unknown[] = []
      const results2: unknown[] = []
      handle.onData((e) => results1.push(e))
      handle.onData((e) => results2.push(e))

      gw.pushSubscriptionData("sub-1", { id: "u1" })

      expect(results1).toHaveLength(1)
      expect(results2).toHaveLength(1)
    })

    it("onData returns an unsubscribe function that removes the listener", () => {
      gw.generateSchema()
      const handle = gw.subscribe("sub-1", "onUsersChanged")
      const received: unknown[] = []
      const removeListener = handle.onData((e) => received.push(e))

      gw.pushSubscriptionData("sub-1", { id: "u1" })
      expect(received).toHaveLength(1)

      removeListener()
      gw.pushSubscriptionData("sub-1", { id: "u2" })
      expect(received).toHaveLength(1)
    })

    it("throws GraphQLGatewayError for unknown subscription field", () => {
      gw.generateSchema()
      expect(() => gw.subscribe("sub-1", "onFooChanged")).toThrow(GraphQLGatewayError)
      expect(() => gw.subscribe("sub-1", "onFooChanged")).toThrow("Unknown subscription field")
    })
  })

  // ── getSubscriptionsForTable ─────────────────────────────────────────────

  describe("getSubscriptionsForTable()", () => {
    it("returns subscription ids for a given table", () => {
      gw.generateSchema()
      gw.subscribe("sub-1", "onUsersChanged")
      gw.subscribe("sub-2", "onUsersList")
      gw.subscribe("sub-3", "onTasksChanged")

      const usersSubs = gw.getSubscriptionsForTable("users")
      expect(usersSubs).toContain("sub-1")
      expect(usersSubs).toContain("sub-2")
      expect(usersSubs).not.toContain("sub-3")
    })

    it("returns empty array for table with no subscriptions", () => {
      gw.generateSchema()
      expect(gw.getSubscriptionsForTable("users")).toEqual([])
    })

    it("excludes unsubscribed entries", () => {
      gw.generateSchema()
      gw.subscribe("sub-1", "onUsersChanged")
      gw.unsubscribe("sub-1")
      expect(gw.getSubscriptionsForTable("users")).toEqual([])
    })
  })

  // ── Transport Message Handling ───────────────────────────────────────────

  describe("handleTransportMessage()", () => {
    it("connection_init returns connection_ack", () => {
      const response = gw.handleTransportMessage({ type: "connection_init" })
      expect(response).toEqual([{ type: "connection_ack" }])
    })

    it("subscribe with valid subscription returns empty (implicit ack)", () => {
      gw.generateSchema()
      const response = gw.handleTransportMessage({
        id: "sub-1",
        type: "subscribe",
        payload: { query: "subscription { onUsersChanged { id name } }" },
      })
      expect(response).toEqual([])
      expect(gw.subscriptionCount).toBe(1)
    })

    it("subscribe without payload returns error", () => {
      const response = gw.handleTransportMessage({
        id: "sub-1",
        type: "subscribe",
      })
      expect(response).toHaveLength(1)
      expect(response[0].type).toBe("error")
    })

    it("subscribe without id returns error", () => {
      const response = gw.handleTransportMessage({
        type: "subscribe",
        payload: { query: "subscription { onUsersChanged { id } }" },
      })
      expect(response).toHaveLength(1)
      expect(response[0].type).toBe("error")
    })

    it("subscribe with non-subscription query returns error", () => {
      const response = gw.handleTransportMessage({
        id: "sub-1",
        type: "subscribe",
        payload: { query: "query { users { id } }" },
      })
      expect(response).toHaveLength(1)
      expect(response[0].type).toBe("error")
      expect((response[0].payload as { message: string }).message).toContain("Expected subscription")
    })

    it("subscribe with unknown field returns error", () => {
      gw.generateSchema()
      const response = gw.handleTransportMessage({
        id: "sub-1",
        type: "subscribe",
        payload: { query: "subscription { onNonexistent { id } }" },
      })
      expect(response).toHaveLength(1)
      expect(response[0].type).toBe("error")
      expect((response[0].payload as { message: string }).message).toContain("Unknown subscription field")
    })

    it("complete message unsubscribes and returns complete", () => {
      gw.generateSchema()
      gw.handleTransportMessage({
        id: "sub-1",
        type: "subscribe",
        payload: { query: "subscription { onUsersChanged { id } }" },
      })
      expect(gw.subscriptionCount).toBe(1)

      const response = gw.handleTransportMessage({ id: "sub-1", type: "complete" })
      expect(response).toEqual([{ id: "sub-1", type: "complete" }])
      expect(gw.subscriptionCount).toBe(0)
    })

    it("complete without id still returns complete", () => {
      const response = gw.handleTransportMessage({ type: "complete" })
      expect(response).toEqual([{ id: undefined, type: "complete" }])
    })

    it("unknown message type returns empty array", () => {
      const response = gw.handleTransportMessage({ type: "next" } as SubscriptionTransportMessage)
      expect(response).toEqual([])
    })
  })

  // ── Client Config Generation ─────────────────────────────────────────────

  describe("generateApolloClientConfig()", () => {
    it("generates config containing wsUrl and httpUrl", () => {
      const config = gw.generateApolloClientConfig("ws://localhost:3000/graphql")
      expect(config).toContain("ws://localhost:3000/graphql")
      expect(config).toContain("http://localhost:3000/graphql")
    })

    it("uses provided httpUrl when given", () => {
      const config = gw.generateApolloClientConfig("ws://localhost:3000/graphql", "https://api.example.com/graphql")
      expect(config).toContain("https://api.example.com/graphql")
    })

    it("imports from @apollo/client", () => {
      const config = gw.generateApolloClientConfig("ws://localhost:3000/graphql")
      expect(config).toContain("@apollo/client")
    })

    it("imports from graphql-ws", () => {
      const config = gw.generateApolloClientConfig("ws://localhost:3000/graphql")
      expect(config).toContain("graphql-ws")
    })

    it("creates ApolloClient instance", () => {
      const config = gw.generateApolloClientConfig("ws://localhost:3000/graphql")
      expect(config).toContain("new ApolloClient")
    })

    it("converts wss:// to https:// for auto-derived httpUrl", () => {
      const config = gw.generateApolloClientConfig("wss://prod.example.com/graphql")
      expect(config).toContain("https://prod.example.com/graphql")
    })
  })

  describe("generateUrqlClientConfig()", () => {
    it("generates config containing wsUrl and httpUrl", () => {
      const config = gw.generateUrqlClientConfig("ws://localhost:3000/graphql")
      expect(config).toContain("ws://localhost:3000/graphql")
      expect(config).toContain("http://localhost:3000/graphql")
    })

    it("uses provided httpUrl when given", () => {
      const config = gw.generateUrqlClientConfig("ws://localhost:3000/graphql", "https://api.example.com/graphql")
      expect(config).toContain("https://api.example.com/graphql")
    })

    it("imports from urql", () => {
      const config = gw.generateUrqlClientConfig("ws://localhost:3000/graphql")
      expect(config).toContain("from 'urql'")
    })

    it("imports from graphql-ws", () => {
      const config = gw.generateUrqlClientConfig("ws://localhost:3000/graphql")
      expect(config).toContain("graphql-ws")
    })

    it("uses subscriptionExchange", () => {
      const config = gw.generateUrqlClientConfig("ws://localhost:3000/graphql")
      expect(config).toContain("subscriptionExchange")
    })
  })

  // ── Type Definition Generation ───────────────────────────────────────────

  describe("generateTypeDefinitions()", () => {
    it("generates TypeScript interfaces for OBJECT types", () => {
      const defs = gw.generateTypeDefinitions()
      expect(defs).toContain("export interface Users {")
      expect(defs).toContain("export interface Tasks {")
    })

    it("generates TypeScript interfaces for INPUT_OBJECT types", () => {
      const defs = gw.generateTypeDefinitions()
      expect(defs).toContain("export interface UsersInput {")
      expect(defs).toContain("export interface TasksInput {")
    })

    it("maps ID! to string", () => {
      const defs = gw.generateTypeDefinitions()
      expect(defs).toContain("id: string;")
    })

    it("maps String! to string", () => {
      const defs = gw.generateTypeDefinitions()
      expect(defs).toMatch(/name: string;/)
    })

    it("maps Boolean (optional) to boolean | null", () => {
      const defs = gw.generateTypeDefinitions()
      expect(defs).toContain("done: boolean | null;")
    })

    it("input fields use optional (?) syntax", () => {
      const defs = gw.generateTypeDefinitions()
      // Input fields should all have ?:
      const inputMatch = defs.match(/export interface UsersInput \{([^}]+)\}/)
      expect(inputMatch).toBeTruthy()
      expect(inputMatch![1]).toContain("name?:")
      expect(inputMatch![1]).toContain("email?:")
    })

    it("includes auto-generated header comment", () => {
      const defs = gw.generateTypeDefinitions()
      expect(defs).toContain("Auto-generated TypeScript types")
    })
  })

  // ── Custom Scalars ───────────────────────────────────────────────────────

  describe("custom scalars", () => {
    it("adds custom scalar declarations to SDL", () => {
      const custom = makeGateway({
        customScalars: { URL: "A valid URL string", Decimal: "High-precision decimal" },
      })
      const { sdl } = custom.generateSchema()
      expect(sdl).toContain("scalar URL")
      expect(sdl).toContain("scalar Decimal")
      custom.destroy()
    })

    it("includes doc string for custom scalars", () => {
      const custom = makeGateway({
        customScalars: { URL: "A valid URL string" },
      })
      const { sdl } = custom.generateSchema()
      expect(sdl).toContain('"""A valid URL string"""')
      custom.destroy()
    })
  })

  // ── Additional Column Type Mappings ──────────────────────────────────────

  describe("column type mappings", () => {
    function makeSchemaWithColumn(type: string, isOptional = false) {
      return {
        tableNames: ["items"],
        tables: {
          items: {
            columns: {
              field: { type, isOptional },
            },
          },
        },
      }
    }

    it("maps number to Float", () => {
      const g = new GraphQLSubscriptionGateway({ schema: makeSchemaWithColumn("number") })
      const { sdl } = g.generateSchema()
      expect(sdl).toContain("field: Float!")
      g.destroy()
    })

    it("maps integer to Int", () => {
      const g = new GraphQLSubscriptionGateway({ schema: makeSchemaWithColumn("integer") })
      const { sdl } = g.generateSchema()
      expect(sdl).toContain("field: Int!")
      g.destroy()
    })

    it("maps timestamp to DateTime", () => {
      const g = new GraphQLSubscriptionGateway({ schema: makeSchemaWithColumn("timestamp") })
      const { sdl } = g.generateSchema()
      expect(sdl).toContain("field: DateTime!")
      g.destroy()
    })

    it("maps json to JSON", () => {
      const g = new GraphQLSubscriptionGateway({ schema: makeSchemaWithColumn("json") })
      const { sdl } = g.generateSchema()
      expect(sdl).toContain("field: JSON!")
      g.destroy()
    })

    it("maps vector to [Float!]", () => {
      const g = new GraphQLSubscriptionGateway({ schema: makeSchemaWithColumn("vector") })
      const { sdl } = g.generateSchema()
      expect(sdl).toContain("field: [Float!]!")
      g.destroy()
    })

    it("maps array to [String!]", () => {
      const g = new GraphQLSubscriptionGateway({ schema: makeSchemaWithColumn("array") })
      const { sdl } = g.generateSchema()
      expect(sdl).toContain("field: [String!]!")
      g.destroy()
    })

    it("maps unknown types to String", () => {
      const g = new GraphQLSubscriptionGateway({ schema: makeSchemaWithColumn("custom_thing") })
      const { sdl } = g.generateSchema()
      expect(sdl).toContain("field: String!")
      g.destroy()
    })

    it("optional columns omit the ! suffix", () => {
      const g = new GraphQLSubscriptionGateway({ schema: makeSchemaWithColumn("number", true) })
      const { sdl } = g.generateSchema()
      // Should have "field: Float" without "!"
      expect(sdl).toMatch(/field: Float(?!!)/)
      g.destroy()
    })
  })

  // ── Error Handling ───────────────────────────────────────────────────────

  describe("error handling", () => {
    it("GraphQLGatewayError has correct name", () => {
      const err = new GraphQLGatewayError("test error")
      expect(err.name).toBe("GraphQLGatewayError")
      expect(err.message).toBe("test error")
    })

    it("GraphQLGatewayError extends Error", () => {
      const err = new GraphQLGatewayError("test")
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(GraphQLGatewayError)
    })
  })

  // ── destroy() ────────────────────────────────────────────────────────────

  describe("destroy()", () => {
    it("removes all active subscriptions", () => {
      gw.generateSchema()
      gw.subscribe("sub-1", "onUsersChanged")
      gw.subscribe("sub-2", "onTasksChanged")
      expect(gw.subscriptionCount).toBe(2)

      gw.destroy()
      expect(gw.subscriptionCount).toBe(0)
    })

    it("clears cached schema so next generateSchema re-generates", () => {
      const first = gw.generateSchema()
      gw.destroy()
      const second = gw.generateSchema()
      // After destroy + regenerate, should be a new object
      expect(first).not.toBe(second)
      // But content should be equivalent
      expect(first.sdl).toBe(second.sdl)
    })

    it("stops delivering data to listeners after destroy", () => {
      gw.generateSchema()
      const handle = gw.subscribe("sub-1", "onUsersChanged")
      const received: unknown[] = []
      handle.onData((e) => received.push(e))

      gw.destroy()
      gw.pushSubscriptionData("sub-1", { id: "u1" })
      expect(received).toHaveLength(0)
    })
  })

  // ── Singularization ──────────────────────────────────────────────────────

  describe("singularization of table names", () => {
    it("singularizes 'users' to 'user'", () => {
      const { queryFields } = gw.generateSchema()
      expect(queryFields.map((f) => f.name)).toContain("user")
    })

    it("singularizes 'tasks' to 'task'", () => {
      const { queryFields } = gw.generateSchema()
      expect(queryFields.map((f) => f.name)).toContain("task")
    })

    it("singularizes -ies ending", () => {
      const schema = {
        tableNames: ["categories"],
        tables: {
          categories: {
            columns: { name: { type: "string", isOptional: false } },
          },
        },
      }
      const g = new GraphQLSubscriptionGateway({ schema })
      const { queryFields } = g.generateSchema()
      expect(queryFields.map((f) => f.name)).toContain("category")
      g.destroy()
    })

    it("singularizes -ses ending", () => {
      const schema = {
        tableNames: ["addresses"],
        tables: {
          addresses: {
            columns: { street: { type: "string", isOptional: false } },
          },
        },
      }
      const g = new GraphQLSubscriptionGateway({ schema })
      const { queryFields } = g.generateSchema()
      expect(queryFields.map((f) => f.name)).toContain("address")
      g.destroy()
    })
  })

  // ── PascalCase Conversion ────────────────────────────────────────────────

  describe("pascalCase conversion for type names", () => {
    it("converts snake_case table names to PascalCase", () => {
      const schema = {
        tableNames: ["user_profiles"],
        tables: {
          user_profiles: {
            columns: { bio: { type: "string", isOptional: true } },
          },
        },
      }
      const g = new GraphQLSubscriptionGateway({ schema })
      const { sdl } = g.generateSchema()
      expect(sdl).toContain("type UserProfiles {")
      g.destroy()
    })

    it("converts kebab-case table names to PascalCase", () => {
      const schema = {
        tableNames: ["user-profiles"],
        tables: {
          "user-profiles": {
            columns: { bio: { type: "string", isOptional: true } },
          },
        },
      }
      const g = new GraphQLSubscriptionGateway({ schema })
      const { sdl } = g.generateSchema()
      expect(sdl).toContain("type UserProfiles {")
      g.destroy()
    })
  })
})
