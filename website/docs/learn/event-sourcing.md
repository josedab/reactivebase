---
sidebar_position: 16
---

# Event Sourcing & Time-Travel

*Estimated time: 12 minutes*

ReactiveBase includes an event sourcing engine (`EventStore`, `ProjectionEngine`) and a time-travel system (`TimeTravelEngine`, `TemporalQuery`) for building event-driven architectures with full history reconstruction. Both are exported from `@reactivebase/server` under the `realtime` and `data` categories.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Event** | An immutable fact that something happened (e.g., `OrderPlaced`) |
| **Stream** | An ordered sequence of events for an aggregate (e.g., all events for order #42) |
| **Projection** | A read model built by replaying events (e.g., current order status) |
| **Snapshot** | A point-in-time materialization of a stream to avoid full replay |
| **Command** | An intent to change state — validated and converted to events |

## Event Store Setup

### 1. Create an Event Store

```typescript
import { EventStore } from "@reactivebase/server"

const eventStore = new EventStore({
  tableName: "events",
  snapshotInterval: 100, // snapshot every 100 events
})
```

### 2. Append Events

Events are appended to a stream with optimistic concurrency control:

```typescript
import type { DomainEvent } from "@reactivebase/server"

interface OrderPlaced {
  orderId: string
  customerId: string
  items: Array<{ productId: string; quantity: number }>
  total: number
}

interface OrderShipped {
  orderId: string
  trackingNumber: string
}

await eventStore.append(
  "order-42",          // stream ID
  [
    {
      type: "OrderPlaced",
      data: {
        orderId: "42",
        customerId: "c-1",
        items: [{ productId: "p-1", quantity: 2 }],
        total: 59.98,
      },
      metadata: {
        userId: "admin-1",
        source: "api",
        correlationId: "req-abc",
      },
    },
  ],
  0, // expected version (optimistic concurrency)
)
```

If another process has appended events since the expected version, the append fails — preventing lost updates.

### 3. Read Events

```typescript
// Get all events for a stream
const events = await eventStore.getEvents("order-42")

// Get events from a specific version
const recent = await eventStore.getEvents("order-42", 5)

// Query events across streams
const allShipped = await eventStore.queryEvents({
  eventType: "OrderShipped",
  fromTimestamp: Date.now() - 86_400_000, // last 24 hours
})
```

## Defining Projections

Projections transform event streams into read models. Each projection defines handlers for the event types it cares about.

```typescript
import type { Projection } from "@reactivebase/server"

interface OrderState {
  orderId: string
  status: "placed" | "shipped" | "delivered"
  total: number
  trackingNumber?: string
}

const orderProjection: Projection<OrderState> = {
  name: "order-status",
  initialState: {
    orderId: "",
    status: "placed",
    total: 0,
  },
  handlers: {
    OrderPlaced: (state, event) => ({
      ...state,
      orderId: event.data.orderId,
      status: "placed",
      total: event.data.total,
    }),
    OrderShipped: (state, event) => ({
      ...state,
      status: "shipped",
      trackingNumber: event.data.trackingNumber,
    }),
    OrderDelivered: (state) => ({
      ...state,
      status: "delivered",
    }),
  },
}
```

### Register and Query Projections

```typescript
// Register the projection
eventStore.projections.register(orderProjection)

// Process new events (called automatically on append, or manually)
await eventStore.projections.process(newEvent)

// Query the current state
const orderState = eventStore.projections.getState<OrderState>("order-status")
// => { orderId: "42", status: "shipped", total: 59.98, trackingNumber: "TRK-123" }

// Rebuild projection from scratch
await eventStore.projections.rebuild()

// List all registered projections
const projections = eventStore.projections.listProjections()
```

## Snapshots

Snapshots avoid replaying the entire event history to reconstruct state:

```typescript
// Create a snapshot
await eventStore.createSnapshot("order-42", currentState)

// Get the latest snapshot (used internally to speed up replay)
const snapshot = await eventStore.getLatestSnapshot("order-42")
// => { state, version, timestamp }
```

The `snapshotInterval` option in the EventStore config controls automatic snapshot creation.

## CQRS Commands

Commands represent intent to change state. They validate input and produce events:

```typescript
import type { CommandHandler } from "@reactivebase/server"

const placeOrder: CommandHandler<PlaceOrderCommand, [OrderPlaced]> = {
  type: "PlaceOrder",
  handle: async (command, currentState) => {
    if (command.items.length === 0) {
      throw new Error("Order must have at least one item")
    }
    return [
      {
        type: "OrderPlaced",
        data: {
          orderId: command.orderId,
          customerId: command.customerId,
          items: command.items,
          total: command.total,
        },
      },
    ]
  },
}

// Register and execute
eventStore.registerCommand(placeOrder)
await eventStore.executeCommand("PlaceOrder", {
  orderId: "43",
  customerId: "c-2",
  items: [{ productId: "p-3", quantity: 1 }],
  total: 29.99,
})
```

## Event Subscriptions

React to events as they happen:

```typescript
// Subscribe to a specific event type
const unsubscribe = eventStore.subscribe("OrderPlaced", async (event) => {
  // Send confirmation email, update analytics, etc.
  await sendOrderConfirmation(event.data)
})

// Unsubscribe
unsubscribe()
```

## Debug Replay

Step through events one at a time to debug state transitions:

```typescript
const session = await eventStore.startReplay("order-42")

// Step through events
let state = await eventStore.stepReplay(session.id)
console.log("After event 1:", state)

state = await eventStore.stepReplay(session.id)
console.log("After event 2:", state)

// Get current replay state
const current = eventStore.getReplayState(session.id)
```

## Time-Travel Queries

The `TimeTravelEngine` records all mutations and supports point-in-time queries independently of the event store.

### Setup

```typescript
import { TimeTravelEngine } from "@reactivebase/server"

const timeTravel = new TimeTravelEngine({
  retentionDays: 90, // keep 90 days of history
})
```

### Recording Mutations

```typescript
timeTravel.recordMutation({
  table: "users",
  rowId: "u-1",
  operation: "update",
  before: { name: "Alice", email: "old@example.com" },
  after: { name: "Alice", email: "new@example.com" },
  userId: "admin-1",
  timestamp: Date.now(),
})
```

### Point-in-Time Queries with `asOf()`

```typescript
import { TemporalQuery } from "@reactivebase/server"

const temporal = new TemporalQuery(timeTravel)

// What did this row look like yesterday?
const yesterday = Date.now() - 86_400_000
const userState = await temporal.at(yesterday).getRow("users", "u-1")

// What did the entire table look like last week?
const lastWeek = Date.now() - 7 * 86_400_000
const allUsers = await temporal.at(lastWeek).getTable("users")

// What changed between two points in time?
const diff = await temporal.at(yesterday).diff(Date.now())
// => { added: [...], modified: [...], deleted: [...] }
```

### Row History

```typescript
// Full history of a specific row
const history = await timeTravel.getRowHistory("users", "u-1")
// => [{ operation: "insert", after: {...}, timestamp }, { operation: "update", before, after, timestamp }, ...]

// Reconstruct row state at a specific time
const stateAt = await timeTravel.getRowStateAt("users", "u-1", timestamp)
```

### Diff Between Timestamps

```typescript
const diff = await timeTravel.diff(fromTimestamp, toTimestamp)
// => { tables: { users: { inserts: 5, updates: 12, deletes: 1 } } }
```

## Retention Policies

```typescript
// Manual pruning
await timeTravel.prune()

// Automatic pruning on an interval
timeTravel.startAutoPrune()
```

Events older than `retentionDays` are deleted, except in compliance mode where critical audit entries are preserved.

## Audit Trail

The `AuditTrail` records all data access events for compliance:

```typescript
import { AuditTrail } from "@reactivebase/server"

const audit = new AuditTrail({ retentionDays: 365 })

// Record an access event
audit.record({
  action: "read",
  resource: "users.ssn",
  userId: "admin-1",
  severity: "high",
})

// Query audit entries
const entries = await audit.query({
  userId: "admin-1",
  fromTimestamp: lastWeek,
  severity: "high",
})

// Combined timeline (mutations + audit events)
import { TimelineBuilder } from "@reactivebase/server"
const timeline = new TimelineBuilder(timeTravel, audit)
const combined = await timeline.build(fromTimestamp, toTimestamp)
```

## Next Steps

→ [Database Branching](./branching.md) — Create isolated database branches for development and CI
→ [Transactions](./transactions.md) — Learn about automatic serializable transactions
