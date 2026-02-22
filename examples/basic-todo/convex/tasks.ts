/**
 * Task queries and mutations.
 *
 * Queries are reactive — subscribed clients auto-update when data changes.
 * Mutations run in serializable Postgres transactions.
 */

import { query, mutation, action } from "@reactivebase/server"
import type { FunctionContext } from "@reactivebase/server"

// --- Queries (reactive reads) ---

/**
 * List tasks for a user, ordered by priority.
 * Clients subscribing to this query will receive automatic updates
 * whenever any task is inserted, updated, or deleted.
 */
export const listTasks = query(
  async (ctx: FunctionContext, args: { userId: string }) => {
    return ctx.db.tasks
      .where({ assigneeId: args.userId, done: false })
      .orderBy("priority", "desc")
  },
)

/**
 * Get task statistics for a user.
 */
export const taskStats = query(
  async (ctx: FunctionContext, args: { userId: string }) => {
    const total = await ctx.db.tasks
      .where({ assigneeId: args.userId })
      .count()

    const completed = await ctx.db.tasks
      .where({ assigneeId: args.userId, done: true })
      .count()

    return {
      total,
      completed,
      remaining: total - completed,
      rate: total > 0 ? completed / total : 0,
    }
  },
)

// --- Mutations (transactional writes) ---

/**
 * Create a new task. Runs in a SERIALIZABLE transaction.
 */
export const createTask = mutation(
  async (ctx: FunctionContext, args: {
    title: string
    description?: string
    priority: "low" | "medium" | "high" | "critical"
    assigneeId: string
  }) => {
    return ctx.db.tasks.insert({
      title: args.title,
      description: args.description,
      priority: args.priority,
      assigneeId: args.assigneeId,
      done: false,
    })
  },
)

/**
 * Mark a task as complete.
 */
export const completeTask = mutation(
  async (ctx: FunctionContext, args: { taskId: string }) => {
    await ctx.db.tasks.update(args.taskId, { done: true })
    return { success: true }
  },
)

/**
 * Delete a task.
 */
export const deleteTask = mutation(
  async (ctx: FunctionContext, args: { taskId: string }) => {
    await ctx.db.tasks.delete(args.taskId)
    return { success: true }
  },
)

/**
 * Reassign all tasks from one user to another.
 * Demonstrates multi-row transaction safety.
 */
export const reassignTasks = mutation(
  async (ctx: FunctionContext, args: { fromId: string; toId: string }) => {
    const tasks = await ctx.db.tasks.where({ assigneeId: args.fromId, done: false })

    // All updates run in a single SERIALIZABLE transaction
    for (const task of tasks as Array<{ id: string }>) {
      await ctx.db.tasks.update(task.id, { assigneeId: args.toId })
    }

    return { reassigned: (tasks as unknown[]).length }
  },
)

// --- Actions (background jobs) ---

/**
 * Send a notification when a task is completed.
 * Actions run outside transactions for side effects.
 */
export const sendCompletionNotification = action(
  async (ctx: FunctionContext, args: { taskId: string; userId: string }) => {
    const task = await ctx.db.tasks.get(args.taskId)
    const user = await ctx.db.users.get(args.userId)

    if (!task || !user) return

    // In production, this would send an email or push notification
    ctx.log.info("Task completed notification", {
      task: (task as Record<string, unknown>).title,
      user: (user as Record<string, unknown>).name,
    })
  },
)
