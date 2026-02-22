---
sidebar_position: 3
---

# Automatic Transactions

*Estimated time: 5 minutes*

Every mutation in ReactiveBase runs inside a PostgreSQL `SERIALIZABLE` transaction. If anything fails, everything rolls back. Serialization conflicts are retried automatically (up to 3 times).

## Why This Matters

In typical backends, developers must manually wrap related writes in transactions:

```typescript
// ❌ Without ReactiveBase — manual transaction management
const client = await pool.connect()
try {
  await client.query("BEGIN")
  await client.query("UPDATE accounts SET balance = balance - $1 WHERE id = $2", [100, fromId])
  await client.query("UPDATE accounts SET balance = balance + $1 WHERE id = $2", [100, toId])
  await client.query("COMMIT")
} catch (e) {
  await client.query("ROLLBACK")
  throw e
} finally {
  client.release()
}
```

With ReactiveBase, the framework handles this automatically:

```typescript
// ✅ With ReactiveBase — automatic serializable transaction
export const transfer = mutation(async (ctx, { fromId, toId, amount }) => {
  const from = await ctx.db.accounts.getOrThrow(fromId)
  if (from.balance < amount) throw new Error("Insufficient funds")

  await ctx.db.accounts.update(fromId, { balance: from.balance - amount })
  await ctx.db.accounts.update(toId, { balance: ctx.db.accounts.get(toId).balance + amount })

  return { success: true }
  // If ANY of these operations fail → entire mutation rolls back
  // If two users transfer at the same time → serialization conflict → automatic retry
})
```

## Serialization Conflict Handling

PostgreSQL `SERIALIZABLE` isolation detects when two transactions read/write overlapping data. When this happens, one transaction is aborted with a serialization error.

ReactiveBase **automatically retries** the aborted transaction (up to 3 times) with fresh data from the database. Your mutation function is re-executed from scratch — so it always sees consistent data.

## Next Steps

→ [Learning Paths](./index.md) — Choose your next path
