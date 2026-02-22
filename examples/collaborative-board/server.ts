import {
  createReactiveBaseServer,
  defineConfig,
  PresenceManager,
  rateLimit,
} from "@reactivebase/server"
import schema from "./convex/schema.js"
import * as board from "./convex/board.js"

const config = defineConfig({
  database: {
    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/collab",
    poolSize: 20,
  },
  server: { port: 4000 },
})

const server = createReactiveBaseServer(schema, config)

// Presence system for live cursors
const presence = new PresenceManager({ ttl: 30_000 })
presence.startCleanup()

// Rate limiting
server.use(rateLimit({ limit: 100, window: 60_000 }))

// Request logging
server.use({
  name: "logger",
  before: (ctx) => {
    ctx.state.set("startTime", performance.now())
  },
  after: (ctx) => {
    const start = ctx.state.get("startTime") as number
    const duration = (performance.now() - start).toFixed(1)
    console.log(`${ctx.functionType}:${ctx.functionName} ${duration}ms`)
  },
})

// Register functions
server.registerFunctions({
  "board.getBoard": board.getBoard,
  "board.listColumns": board.listColumns,
  "board.listTasks": board.listTasks,
  "board.createBoard": board.createBoard,
  "board.createTask": board.createTask,
  "board.moveTask": board.moveTask,
  "board.updateTask": board.updateTask,
  "board.deleteTask": board.deleteTask,
  "board.searchTasks": board.searchTasks,
})

server.start().then(({ port }) => {
  console.log(`
  🎯 Collaborative Board Demo
  
  Server:    http://localhost:${port}
  WebSocket: ws://localhost:${port}/ws
  Dashboard: http://localhost:${port}/dashboard
  Metrics:   http://localhost:${port}/metrics
  
  Features demonstrated:
  • Reactive queries (real-time board updates)
  • Automatic transactions (drag & drop moves)
  • Presence tracking (live cursors)
  • Rate limiting (100 req/min per user)
  • Request logging middleware
  • AI task search
  `)
})
