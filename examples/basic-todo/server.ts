/**
 * Server entry point for the basic todo example.
 * Demonstrates how to create and start a ReactiveBase server.
 */

import { createReactiveBaseServer, defineConfig } from "@reactivebase/server"
import schema from "./convex/schema.js"
import * as tasks from "./convex/tasks.js"

const config = defineConfig({
  database: {
    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/todos",
    poolSize: 10,
  },
  server: {
    port: 4000,
  },
})

const server = createReactiveBaseServer(schema, config)

// Register all server functions
server.registerFunctions({
  "tasks.listTasks": tasks.listTasks,
  "tasks.taskStats": tasks.taskStats,
  "tasks.createTask": tasks.createTask,
  "tasks.completeTask": tasks.completeTask,
  "tasks.deleteTask": tasks.deleteTask,
  "tasks.reassignTasks": tasks.reassignTasks,
  "tasks.sendCompletionNotification": tasks.sendCompletionNotification,
})

// Optional: add middleware for logging
server.use({
  name: "request-logger",
  before: (ctx) => {
    ctx.state.set("startTime", performance.now())
    console.log(`→ ${ctx.functionType}:${ctx.functionName}`)
  },
  after: (ctx) => {
    const start = ctx.state.get("startTime") as number
    const duration = (performance.now() - start).toFixed(1)
    console.log(`← ${ctx.functionType}:${ctx.functionName} (${duration}ms)`)
  },
})

server.start().then(({ port }) => {
  console.log(`🚀 Todo API running at http://localhost:${port}`)
  console.log(`📊 Metrics at http://localhost:${port}/metrics`)
  console.log(`🔌 WebSocket at ws://localhost:${port}/ws`)
})
