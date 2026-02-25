# ReactiveBase Examples

Choose an example based on what you want to learn:

| Example                                        | Complexity   | Features Demonstrated                                                        | Prerequisites |
| ---------------------------------------------- | ------------ | ---------------------------------------------------------------------------- | ------------- |
| [basic-todo](./basic-todo)                     | Beginner     | Reactive queries, mutations, actions, middleware                             | PostgreSQL    |
| [collaborative-board](./collaborative-board)   | Intermediate | Real-time collaboration, presence tracking, rate limiting, semantic search   | PostgreSQL    |
| [collaborative-editor](./collaborative-editor) | Advanced     | Yjs CRDT integration, shared cursors, offline editing, conflict-free merging | PostgreSQL    |
| [project-manager](./project-manager)           | Advanced     | RBAC, Kanban boards, reactive dashboards, row-level security                 | PostgreSQL    |
| [saas-dashboard](./saas-dashboard)             | Advanced     | Multi-tenant isolation, live metrics, IVM aggregations, alert thresholds     | PostgreSQL    |

## Getting Started

**New to ReactiveBase?** Start with [`basic-todo`](./basic-todo) — it covers schema definition, queries, mutations, and actions in a minimal setup.

**Building a collaborative app?** Move on to [`collaborative-board`](./collaborative-board) for presence tracking and rate limiting, or [`collaborative-editor`](./collaborative-editor) for CRDT-based real-time editing.

**Building a production app?** See [`project-manager`](./project-manager) for role-based access control and dashboards, or [`saas-dashboard`](./saas-dashboard) for multi-tenant analytics.

## Prerequisites

All examples require:

- **Node.js** 20+
- **PostgreSQL** 14+
- A `.env` file with `DATABASE_URL` (see each example's `.env.example`)

## Running an Example

```bash
cd examples/<example-name>
cp .env.example .env    # Configure your database URL
npm install
npm run dev
```
