import { query, mutation } from "@reactivebase/server"

// ─── Queries (all reactive — clients auto-update) ────────────────────────────

export const listBoards = query(async (ctx, { projectId }: { projectId: string }) => {
  return ctx.db.boards.where({ projectId }).orderBy("createdAt", "asc")
})

export const boardTasks = query(async (ctx, { boardId }: { boardId: string }) => {
  return ctx.db.tasks.where({ boardId }).orderBy("position", "asc")
})

export const tasksByStatus = query(async (ctx, { boardId, status }: { boardId: string; status: string }) => {
  return ctx.db.tasks.where({ boardId, status }).orderBy("position", "asc")
})

export const taskDetail = query(async (ctx, { taskId }: { taskId: string }) => {
  const task = await ctx.db.tasks.get(taskId)
  if (!task) return null
  const comments = await ctx.db.comments.where({ taskId }).orderBy("createdAt", "asc")
  return { ...task, comments }
})

export const projectStats = query(async (ctx, { projectId }: { projectId: string }) => {
  const total = await ctx.db.tasks.where({ projectId }).count()
  const done = await ctx.db.tasks.where({ projectId, status: "done" }).count()
  const inProgress = await ctx.db.tasks.where({ projectId, status: "in_progress" }).count()
  return { total, done, inProgress, remaining: total - done, completionRate: total > 0 ? done / total : 0 }
})

// ─── Mutations (serializable transactions) ───────────────────────────────────

export const createTask = mutation(async (ctx, args: {
  boardId: string; projectId: string; title: string; priority: string; assigneeId?: string
}) => {
  const count = await ctx.db.tasks.where({ boardId: args.boardId }).count()
  return ctx.db.tasks.insert({
    boardId: args.boardId, projectId: args.projectId, title: args.title,
    status: "todo", priority: args.priority as any, assigneeId: args.assigneeId,
    position: count, createdAt: new Date(), updatedAt: new Date(),
  })
})

export const moveTask = mutation(async (ctx, args: {
  taskId: string; newStatus: string; newPosition: number
}) => {
  await ctx.db.tasks.update(args.taskId, {
    status: args.newStatus as any, position: args.newPosition, updatedAt: new Date(),
  })
  return { success: true }
})

export const addComment = mutation(async (ctx, args: {
  taskId: string; authorId: string; body: string; parentId?: string
}) => {
  return ctx.db.comments.insert({
    taskId: args.taskId, authorId: args.authorId,
    body: args.body, parentId: args.parentId, createdAt: new Date(),
  })
})
