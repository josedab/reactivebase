import { query, mutation, action, roles } from "@reactivebase/server"
import type { FunctionContext } from "@reactivebase/server"

// --- Board Queries ---

export const getBoard = query(
  async (ctx: FunctionContext, args: { boardId: string }) => {
    return ctx.db.boards.get(args.boardId)
  },
  { access: "authenticated" },
)

export const listColumns = query(
  async (ctx: FunctionContext, args: { boardId: string }) => {
    return ctx.db.columns
      .where({ boardId: args.boardId })
      .orderBy("position", "asc")
  },
)

export const listTasks = query(
  async (ctx: FunctionContext, args: { columnId: string }) => {
    return ctx.db.tasks
      .where({ columnId: args.columnId })
      .orderBy("position", "asc")
  },
)

// --- Board Mutations ---

export const createBoard = mutation(
  async (ctx: FunctionContext, args: { title: string }) => {
    const userId = ctx.auth.requireUser()
    const board = await ctx.db.boards.insert({
      title: args.title,
      ownerId: userId,
    })

    // Create default columns
    const defaultColumns = ["To Do", "In Progress", "Done"]
    for (let i = 0; i < defaultColumns.length; i++) {
      await ctx.db.columns.insert({
        boardId: (board as Record<string, unknown>).id as string,
        title: defaultColumns[i],
        position: i,
      })
    }

    return board
  },
  { access: "authenticated" },
)

export const createTask = mutation(
  async (ctx: FunctionContext, args: {
    columnId: string
    title: string
    description?: string
    priority?: string
    labels?: string[]
  }) => {
    // Get max position in column
    const existing = await ctx.db.tasks.where({ columnId: args.columnId })
    const maxPos = (existing as Array<{ position: number }>).reduce(
      (max: number, t: { position: number }) => Math.max(max, t.position),
      -1,
    )

    return ctx.db.tasks.insert({
      columnId: args.columnId,
      title: args.title,
      description: args.description,
      priority: args.priority ?? "medium",
      position: maxPos + 1,
      labels: args.labels ?? [],
    })
  },
)

export const moveTask = mutation(
  async (ctx: FunctionContext, args: {
    taskId: string
    targetColumnId: string
    targetPosition: number
  }) => {
    return ctx.db.tasks.update(args.taskId, {
      columnId: args.targetColumnId,
      position: args.targetPosition,
    })
  },
)

export const updateTask = mutation(
  async (ctx: FunctionContext, args: {
    taskId: string
    title?: string
    description?: string
    priority?: string
    assigneeId?: string
    labels?: string[]
  }) => {
    const { taskId, ...updates } = args
    return ctx.db.tasks.update(taskId, updates)
  },
)

export const deleteTask = mutation(
  async (ctx: FunctionContext, args: { taskId: string }) => {
    await ctx.db.tasks.delete(args.taskId)
    return { success: true }
  },
)

// --- AI Actions ---

export const searchTasks = action(
  async (ctx: FunctionContext, args: { query: string; boardId: string }) => {
    // In production, this would use ctx.ai.search()
    // For the demo, return matching tasks by title
    const columns = await ctx.db.columns.where({ boardId: args.boardId })
    const results: unknown[] = []

    for (const col of columns as Array<{ id: string }>) {
      const tasks = await ctx.db.tasks.where({ columnId: col.id })
      for (const task of tasks as Array<{ id: string; title: string }>) {
        if (task.title.toLowerCase().includes(args.query.toLowerCase())) {
          results.push(task)
        }
      }
    }

    return results
  },
)
