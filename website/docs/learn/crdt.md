---
sidebar_position: 15
---

# CRDT & Collaboration

*Estimated time: 15 minutes*

ReactiveBase includes conflict-free replicated data types (CRDTs) and a Yjs-compatible collaboration engine for building real-time collaborative features. CRDTs are exported from the `realtime` category, and React hooks are available in `@reactivebase/react`.

## CRDT Types

ReactiveBase implements five CRDT types, each suited to different use cases:

| CRDT Type | Class | Description | Use Cases |
|-----------|-------|-------------|-----------|
| LWW-Register | `lww-register` | Last-writer-wins atomic values | User profile fields, settings, form state |
| G-Counter | `g-counter` | Grow-only counter | Page views, total downloads, event counts |
| PN-Counter | `pn-counter` | Increment and decrement counter | Inventory stock, likes/unlikes, vote counts |
| OR-Set | `or-set` | Add/remove set with tombstones | Tag lists, member lists, feature flags |
| RGA | `rga` | Replicated growable array | Collaborative text, ordered lists |

### Choosing a CRDT Type

```
Need atomic key-value state?          → LWW-Register
Need a counter that only goes up?     → G-Counter
Need a counter that goes up and down? → PN-Counter
Need a set with add/remove?           → OR-Set
Need ordered text or list editing?    → RGA
```

## Server-Side CRDT Engine

### Setup

```typescript
import { CrdtEngine } from "@reactivebase/server"

const crdt = new CrdtEngine({
  nodeId: "server-1", // unique node identifier
})
```

### Creating and Using Documents

```typescript
// Create a document
const doc = crdt.createDocument("settings-doc", "lww-register")

// Get a handle for operations
const handle = crdt.getDocument("settings-doc")

// LWW-Register operations
handle.set("theme", "dark")
handle.set("language", "en")
const theme = handle.get("theme") // => "dark"

// G-Counter operations
const views = crdt.createDocument("page-views", "g-counter")
const viewHandle = crdt.getDocument("page-views")
viewHandle.increment(1)

// PN-Counter operations
const stock = crdt.createDocument("item-stock", "pn-counter")
const stockHandle = crdt.getDocument("item-stock")
stockHandle.increment(100)  // restock
stockHandle.decrement(1)    // sold one

// OR-Set operations
const tags = crdt.createDocument("post-tags", "or-set")
const tagHandle = crdt.getDocument("post-tags")
tagHandle.add("typescript")
tagHandle.add("crdt")
tagHandle.remove("crdt")

// RGA operations (collaborative text)
const text = crdt.createDocument("doc-text", "rga")
const textHandle = crdt.getDocument("doc-text")
textHandle.insertAt(null, "H")    // insert at beginning
textHandle.insertAt("pos-0", "i") // insert after position

// Read current value from any type
const value = handle.getValue()
```

### Merging Remote Operations

```typescript
// Apply an operation from another node
crdt.applyRemoteOperation({
  docId: "settings-doc",
  type: "lww-register",
  data: { key: "theme", value: "light", timestamp: Date.now() },
  clock: { "server-2": 5 },
})
```

### Subscriptions

```typescript
// Subscribe to document changes
const unsubscribe = crdt.subscribe("settings-doc", (state) => {
  console.log("Updated:", state)
})

// Snapshots for persistence
const snapshot = crdt.getSnapshot("settings-doc")
// Restore later with crdt.loadDocument(snapshot)
```

## Collaboration Manager

`CollaborationManager` handles real-time presence features: cursor tracking, text selections, and typing indicators.

```typescript
import { CollaborationManager } from "@reactivebase/server"

const collab = new CollaborationManager()

// User joins a room
const color = collab.join("room-1", "conn-abc", {
  userId: "user-1",
  name: "Alice",
})

// Update cursor position
collab.updateCursor("room-1", "conn-abc", { x: 100, y: 200 })

// Track typing status (auto-expires)
collab.setTyping("room-1", "conn-abc", true)

// Get room state
const state = collab.getRoomState("room-1")
// => { users, cursors, selections, typingUsers }

// Subscribe to awareness changes
collab.onAwarenessChange("room-1", (state) => {
  // Broadcast to connected clients
})

// User leaves
collab.leave("room-1", "conn-abc")
```

## Document Collaboration (Yjs-Compatible)

`DocumentCollaboration` provides shared document editing with a binary protocol compatible with the Yjs ecosystem.

```typescript
import { DocumentCollaboration } from "@reactivebase/server"

const docs = new DocumentCollaboration()

// Create a collaborative document
docs.createDocument("doc-1", "richtext")
// Types: "richtext", "plaintext", "json", "xml"

// Apply an update from a client
docs.applyUpdate("doc-1", updateBytes, "client-abc")

// Get updates since a version (for syncing new clients)
const updates = docs.getUpdates("doc-1", sinceVersion)

// Undo/redo (per-client stacks)
docs.undo("doc-1", "client-abc")
docs.redo("doc-1", "client-abc")

// Snapshots
const snapshot = await docs.createSnapshot("doc-1")
await docs.restoreSnapshot("doc-1", snapshot.id)
```

### Yjs Sync Protocol

ReactiveBase implements the Yjs binary sync protocol for interoperability with Yjs client libraries:

```typescript
import {
  createSyncStep1,
  createSyncStep2,
  createUpdateMessage,
  parseSyncMessage,
  encodeStateVector,
  decodeStateVector,
  mergeUpdates,
} from "@reactivebase/server"

// Server-side sync handler
function handleSyncMessage(data: Uint8Array) {
  const message = parseSyncMessage(data)

  switch (message.type) {
    case "sync-step-1":
      // Client sends state vector, server responds with missing updates
      const response = createSyncStep2(serverDoc, message.stateVector)
      return response
    case "sync-step-2":
      // Server applies updates from client
      applyUpdates(message.update)
      break
    case "update":
      // Incremental update from client
      applyUpdates(message.update)
      // Broadcast to other clients
      broadcastUpdate(message.update)
      break
  }
}
```

## React Hooks

`@reactivebase/react` provides CRDT hooks for client-side collaborative editing:

```typescript
import {
  useCollabText,
  useCollabList,
  useCollabMap,
  useCollabCounter,
} from "@reactivebase/react"
```

### useCollabText

Collaborative real-time text editing:

```tsx
function CollaborativeEditor({ docId }: { docId: string }) {
  const { text, insert, delete: del, onChange } = useCollabText(docId)

  return (
    <textarea
      value={text}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
```

### useCollabList

Collaborative ordered list:

```tsx
function SharedTodoList({ docId }: { docId: string }) {
  const { items, push, remove } = useCollabList<Todo>(docId)

  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>
          {item.title}
          <button onClick={() => remove(i)}>×</button>
        </li>
      ))}
      <button onClick={() => push({ title: "New item" })}>Add</button>
    </ul>
  )
}
```

### useCollabMap

Collaborative key-value map:

```tsx
function SharedSettings({ docId }: { docId: string }) {
  const { data, set, delete: del } = useCollabMap<string>(docId)

  return (
    <div>
      <p>Theme: {data.theme ?? "default"}</p>
      <button onClick={() => set("theme", "dark")}>Dark Mode</button>
    </div>
  )
}
```

### useCollabCounter

Collaborative counter:

```tsx
function VoteCounter({ docId }: { docId: string }) {
  const { value, increment, decrement } = useCollabCounter(docId)

  return (
    <div>
      <button onClick={() => decrement(1)}>-</button>
      <span>{value}</span>
      <button onClick={() => increment(1)}>+</button>
    </div>
  )
}
```

## End-to-End Example

A collaborative document editor with presence:

```typescript
// server/functions.ts
import { mutation, query } from "@reactivebase/server"
import { CollaborationManager, DocumentCollaboration } from "@reactivebase/server"

const collab = new CollaborationManager()
const docs = new DocumentCollaboration()

export const joinRoom = mutation(async (ctx, { roomId }: { roomId: string }) => {
  const user = ctx.auth
  collab.join(roomId, ctx.connectionId, {
    userId: user.userId,
    name: user.name,
  })
  return collab.getRoomState(roomId)
})

export const getPresence = query(async (ctx, { roomId }: { roomId: string }) => {
  return collab.getRoomState(roomId)
})
```

```tsx
// client/Editor.tsx
import { useQuery, useMutation } from "@reactivebase/react"
import { useCollabText, useCursors, useTypingUsers } from "@reactivebase/react"
import { api } from "./api"

function Editor({ roomId }: { roomId: string }) {
  const { mutate: join } = useMutation(api.joinRoom)
  const { data: presence } = useQuery(api.getPresence, { roomId })
  const { text, onChange } = useCollabText(roomId)
  const cursors = useCursors()
  const typingUsers = useTypingUsers()

  useEffect(() => { join({ roomId }) }, [roomId])

  return (
    <div>
      <div className="presence-bar">
        {presence?.users.map((u) => (
          <span key={u.id} style={{ color: u.color }}>{u.name}</span>
        ))}
        {typingUsers.length > 0 && (
          <span>{typingUsers.map((u) => u.name).join(", ")} typing...</span>
        )}
      </div>
      <textarea value={text} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
```

## Next Steps

→ [Event Sourcing](./event-sourcing.md) — Build event-driven architectures with projections and time-travel
→ [Reactive Queries](./reactive-queries.md) — Understand how live queries work under the hood
