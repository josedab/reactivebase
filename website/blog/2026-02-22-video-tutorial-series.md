---
slug: video-tutorials
title: "ReactiveBase Video Tutorial Series"
authors: [josedab]
tags: [tutorial, video, getting-started]
---

# ReactiveBase Video Tutorial Series

Learn ReactiveBase in 15 minutes with our 5-part video series.

<!--truncate-->

## Video 1: Quickstart (3 min)

**Title:** "ReactiveBase in 3 Minutes: Your First Reactive App"

**Script outline:**
1. `npx create-reactivebase my-app` → show project structure (30s)
2. Open `convex/schema.ts` → explain defineTable + validators (45s)
3. Open `convex/tasks.ts` → show query + mutation (45s)
4. `npm run dev` → show server starting (15s)
5. Show React component with `useQuery` → data appears (30s)
6. Call mutation → show query auto-updates (15s)

**Key message:** "Every query is live. No WebSocket setup. No cache invalidation."

---

## Video 2: Schema & Type Safety (3 min)

**Title:** "Type-Safe Schemas: From Postgres Types to React Props"

**Script outline:**
1. Show schema with all validator types: string, number, boolean, timestamp, enum, id, vector (45s)
2. Show `.index()` and `.vectorIndex()` (30s)
3. Show `.relation()` for has-many and belongs-to (30s)
4. Run `reactivebase generate` → show generated `api.ts` with typed refs (30s)
5. Show `useQuery(api.tasks.list)` → full autocomplete (30s)
6. Show type error when passing wrong args (15s)

**Key message:** "Define once, types flow everywhere — schema to database to UI."

---

## Video 3: React Hooks Deep Dive (3 min)

**Title:** "useQuery, useMutation, useAction: The Three Hooks"

**Script outline:**
1. `useQuery` — show loading state, then data, then live update (60s)
2. `useMutation` — show optimistic update with rollback on error (45s)
3. `useAction` — show background job trigger (30s)
4. Show `ReactiveBaseProvider` setup (15s)
5. Show Next.js `preloadQuery` → SSR → live hydration (30s)

**Key message:** "Three hooks. That's the entire client API."

---

## Video 4: AI & Vector Search (3 min)

**Title:** "Build a Semantic Search App in 20 Lines"

**Script outline:**
1. Add `v.vector(1536)` to schema + `.vectorIndex()` (30s)
2. Show `openaiProvider()` setup (15s)
3. Write query with `.whereVectorSimilar()` (30s)
4. Show search UI → type query → results update reactively (45s)
5. Insert new document → search results update automatically (30s)
6. Show similarity scores and distance metrics (30s)

**Key message:** "Reactive vector search on Postgres. No Pinecone. No Langchain."

---

## Video 5: Deploy to Production (3 min)

**Title:** "From Localhost to Production in 60 Seconds"

**Script outline:**
1. Show `docker compose up` with Postgres + Redis + ReactiveBase (30s)
2. Show `/dashboard` with live metrics (30s)
3. Show `/metrics` Prometheus endpoint (15s)
4. `fly launch` → deploy to Fly.io (30s)
5. Show rate limiting + auth middleware (30s)
6. Show multi-tenant configuration (15s)
7. End: "19,351 lines. 30 modules. MIT license. reactivebase.dev" (30s)

**Key message:** "Production-ready from day one."

---

## Recording Notes

- Screen resolution: 1920x1080
- Font size: 16px in editor, 14px in terminal
- Use VS Code with GitHub Dark theme
- Terminal: clear between commands
- Cursor highlight plugin for visibility
- Upload to YouTube, embed in docs
