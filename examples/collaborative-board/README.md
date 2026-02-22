# Collaborative Board Demo

A real-time collaborative task board demonstrating ReactiveBase's key features.

## Features Demonstrated

- **Reactive queries** — Board updates in real-time across all connected clients
- **Automatic transactions** — Task moves are atomic (no partial state)
- **Presence tracking** — See other users' cursors and active status
- **Rate limiting** — Built-in request throttling (100/min per user)
- **Middleware** — Request logging with timing
- **AI search** — Semantic task search across the board
- **Schema with relations** — Boards → Columns → Tasks with proper FK relations
- **Vector indexes** — HNSW index on task embeddings for similarity search

## Architecture

```
boards (1) → columns (N) → tasks (N)
   └── owner → users
                  └── tasks.assignee
```

## Quick Start

```bash
export DATABASE_URL="postgresql://localhost:5432/collab"
npm install
npm run dev
```

## API

### Queries (Reactive)
- `board.getBoard({ boardId })` — Get board details
- `board.listColumns({ boardId })` — List columns in order
- `board.listTasks({ columnId })` — List tasks in column order

### Mutations (Transactional)
- `board.createBoard({ title })` — Create board with default columns
- `board.createTask({ columnId, title, priority })` — Add task to column
- `board.moveTask({ taskId, targetColumnId, targetPosition })` — Move task
- `board.updateTask({ taskId, ...fields })` — Update task fields
- `board.deleteTask({ taskId })` — Delete a task

### Actions
- `board.searchTasks({ query, boardId })` — Search tasks by title/content
