---
sidebar_position: 9
---

# Workflows

ReactiveBase includes a workflow engine for orchestrating multi-step, long-running processes with automatic retries, compensation (rollback), and persistence.

## Defining a Workflow

Use `defineWorkflow` to declare a workflow with typed steps:

```typescript
import { defineWorkflow } from "@reactivebase/server"

const onboardUser = defineWorkflow({
  name: "onboard-user",
  options: {
    timeout: 60_000,       // 60s total timeout
    maxRetries: 3,         // retry the whole workflow up to 3 times
    compensateOnFailure: true, // run compensation steps on failure
  },
  handler: async (ctx, args: { userId: string; email: string }) => {
    // Step 1: Create account
    const account = await ctx.step("create-account", async () => {
      return await createAccount(args.userId)
    })

    // Step 2: Send welcome email
    await ctx.step("send-welcome-email", {
      maxRetries: 2,
      timeout: 10_000,
      compensate: async () => {
        // Runs if a later step fails
        await cancelEmail(args.email)
      },
    }, async () => {
      await sendEmail(args.email, "Welcome!", { accountId: account.id })
    })

    // Step 3: Provision resources
    await ctx.step("provision-resources", async () => {
      await provisionStorage(args.userId)
      await provisionDatabase(args.userId)
    })

    return { accountId: account.id, status: "onboarded" }
  },
})
```

## Workflow Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `number` | — | Max execution time in milliseconds |
| `maxRetries` | `number` | `0` | Number of times to retry the full workflow |
| `compensateOnFailure` | `boolean` | `false` | Run compensation functions when a step fails |

## Step Options

Each `ctx.step()` call can include options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRetries` | `number` | `0` | Retry count for this step |
| `timeout` | `number` | — | Step-level timeout in milliseconds |
| `compensate` | `() => Promise<void>` | — | Rollback function run on downstream failure |

## Running the Workflow Engine

The `WorkflowEngine` manages execution, persistence, and retries:

```typescript
import { WorkflowEngine } from "@reactivebase/server"

const engine = new WorkflowEngine({
  db: ctx.db,  // database connection for persistence
})

// Register workflows
engine.register(onboardUser)

// Start the engine (begins polling for pending workflows)
await engine.start()

// Trigger a workflow
const instance = await engine.run("onboard-user", {
  userId: "user_123",
  email: "alice@example.com",
})

console.log(instance.id)     // unique run ID
console.log(instance.status) // "running" | "completed" | "failed" | "waiting" | "cancelled"
```

## Workflow Persistence

Workflows are persisted to Postgres so they survive server restarts. Generate the required table:

```typescript
import { generateWorkflowTableSQL } from "@reactivebase/server"

const sql = generateWorkflowTableSQL()
// Execute this in a migration to create the workflows table
```

The engine uses helper SQL builders internally:

| Function | Purpose |
|----------|---------|
| `buildInsertWorkflowSQL` | Insert a new workflow instance |
| `buildUpdateWorkflowSQL` | Update workflow status and steps |
| `buildGetPendingWorkflowsSQL` | Query workflows ready to run |
| `buildGetWaitingWorkflowsSQL` | Query workflows waiting on external events |

## Workflow Instance

Each running workflow is tracked as a `WorkflowInstance`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique instance ID |
| `workflowName` | `string` | Name of the workflow definition |
| `status` | `string` | `running`, `completed`, `failed`, `waiting`, `cancelled` |
| `args` | `unknown` | Arguments passed when starting the workflow |
| `steps` | `StepRecord[]` | Record of each step's status and result |

## Error Handling

The workflow engine provides typed error classes:

```typescript
import {
  WorkflowError,
  WorkflowStepError,
  WorkflowWaitingError,
  WorkflowCancelledError,
} from "@reactivebase/server"

try {
  await engine.run("onboard-user", { userId: "user_123", email: "a@b.com" })
} catch (err) {
  if (err instanceof WorkflowStepError) {
    console.log(`Step "${err.stepName}" failed: ${err.message}`)
  }
}
```

## Example: Order Processing

```typescript
const processOrder = defineWorkflow({
  name: "process-order",
  options: { compensateOnFailure: true },
  handler: async (ctx, args: { orderId: string }) => {
    const order = await ctx.step("validate-order", async () => {
      return await validateOrder(args.orderId)
    })

    await ctx.step("charge-payment", {
      compensate: async () => await refundPayment(order.paymentId),
    }, async () => {
      await chargePayment(order.paymentId, order.total)
    })

    await ctx.step("reserve-inventory", {
      compensate: async () => await releaseInventory(order.items),
    }, async () => {
      await reserveInventory(order.items)
    })

    await ctx.step("send-confirmation", async () => {
      await sendOrderConfirmation(order.email, args.orderId)
    })

    return { orderId: args.orderId, status: "processed" }
  },
})
```

## Next Steps

- [Plugins](./plugins.md) — Extend the server with reusable plugins
- [Transactions](./transactions.md) — Atomic database operations
- [Performance](./performance.md) — Optimize workflow throughput
