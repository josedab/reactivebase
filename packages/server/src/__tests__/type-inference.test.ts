import { describe, it, expect } from "vitest"
import {
  typedRef,
  type TypedFunctionReference,
  type InferArgs,
  type InferReturn,
  type TypedDatabaseContext,
  type TableRow,
} from "../types/typed-api.js"
import { defineSchema, defineTable, v, type InferSchemaTypes } from "../schema/index.js"

describe("typedRef", () => {
  it("creates a typed function reference", () => {
    const ref = typedRef<{ userId: string }, { id: string; name: string }[], "query">("users.list", "query")

    expect(ref._name).toBe("users.list")
    expect(ref._type).toBe("query")
  })
})

describe("InferSchemaTypes", () => {
  it("infers row types from schema definition", () => {
    const schemaDef = {
      users: defineTable({
        name: v.string(),
        email: v.string(),
        age: v.optional(v.integer()),
      }),
      tasks: defineTable({
        title: v.string(),
        done: v.boolean({ default: false }),
        assigneeId: v.id("users"),
      }),
    }

    type Types = InferSchemaTypes<typeof schemaDef>
    type UserRow = Types["users"]
    type TaskRow = Types["tasks"]

    // These are compile-time checks — if types are wrong, this won't compile
    const user: UserRow = { id: "1", name: "Alice", email: "a@b.com" }
    const task: TaskRow = { id: "2", title: "Test", done: false, assigneeId: "1" }

    expect(user.id).toBe("1")
    expect(task.title).toBe("Test")
  })
})

describe("InferArgs / InferReturn", () => {
  it("extracts types from function reference", () => {
    type Ref = TypedFunctionReference<{ userId: string }, string[]>
    type Args = InferArgs<Ref>
    type Return = InferReturn<Ref>

    // Compile-time type checks
    const args: Args = { userId: "u1" }
    const result: Return = ["a", "b"]

    expect(args.userId).toBe("u1")
    expect(result).toHaveLength(2)
  })
})

describe("Generated API type flow", () => {
  it("maintains types through ref creation and extraction", () => {
    interface TaskArgs {
      userId: string
    }
    interface TaskRow {
      id: string
      title: string
      done: boolean
    }

    const listTasks = typedRef<TaskArgs, TaskRow[], "query">("tasks.list", "query")

    // Verify the runtime value
    expect(listTasks._name).toBe("tasks.list")
    expect(listTasks._type).toBe("query")

    // Verify InferArgs and InferReturn work
    type ListArgs = InferArgs<typeof listTasks>
    type ListReturn = InferReturn<typeof listTasks>

    const args: ListArgs = { userId: "u1" }
    const result: ListReturn = [{ id: "1", title: "Task 1", done: false }]

    expect(args.userId).toBe("u1")
    expect(result[0].title).toBe("Task 1")
  })
})

describe("TableRow utility", () => {
  it("extracts row type for a specific table", () => {
    const schemaDef = {
      users: defineTable({ name: v.string() }),
    }

    type UserRow = TableRow<typeof schemaDef, "users">

    const user: UserRow = { id: "1", name: "Alice" }
    expect(user.name).toBe("Alice")
  })
})
