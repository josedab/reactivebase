# Project Manager — ReactiveBase Example

A real-time project management app (like Linear) built with ReactiveBase.

## Features

- 📋 **Kanban boards** with drag-and-drop (reactive — all users see changes instantly)
- 👥 **Team presence** — see who's viewing which board
- 🔍 **Live search** — filter tasks with reactive query subscriptions
- 🔒 **RBAC** — owner/admin/member roles with row-level security
- 📊 **Dashboard** — real-time task statistics and burndown

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

## Schema

- `projects` — Teams and their settings
- `boards` — Kanban boards per project
- `tasks` — Cards with status, priority, assignee
- `comments` — Task comments with threading

## Architecture

All queries are **reactive** — when any user creates, moves, or completes a task, every connected client's view updates automatically. No polling, no manual refetching.

Mutations run in **SERIALIZABLE** transactions — if two users move the same task simultaneously, one retries automatically.
