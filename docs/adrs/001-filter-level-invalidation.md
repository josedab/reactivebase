# ADR-001: Filter-Level Reactive Invalidation

## Status
Accepted

## Context
When a mutation modifies data, the server must determine which active subscriptions need to be re-executed. There are three possible granularity levels:

1. **Table-level** (Level 1): Any mutation to table X invalidates ALL subscriptions reading from X
2. **Filter-level** (Level 2): Match mutation change-sets against subscription WHERE predicates
3. **Row-level** (Level 3): Track exact row IDs per subscription

## Decision
We implement **filter-level invalidation** (Level 2) as the default, with table-level as a fallback when change-set data is unavailable.

## Rationale
- **Table-level** is too coarse: a task update for user A invalidates subscriptions for ALL users. At 10K subscriptions, this causes 99%+ false invalidation.
- **Row-level** requires tracking every row ID per subscription, consuming significant memory and creating complexity with result set changes.
- **Filter-level** provides the best balance: we track the WHERE predicates of each subscription's dependencies and match them against mutation change-sets. A mutation to `tasks WHERE assigneeId = 'u2'` does NOT invalidate a subscription filtering on `assigneeId = 'u1'`.

## Implementation
- `QueryBuilder.getDependencies()` extracts `{ table, filters }` where `filters` contains equality predicates from WHERE clauses
- `InvalidationEvaluator.evaluate()` matches change event `affectedFilters` against subscription dependency filters
- For updates, both old and new values are checked (a row leaving a result set must also trigger invalidation)
- When no `affectedFilters` are provided, falls back to table-level

## Consequences
- False invalidation rate drops from ~100% (table-level) to ~10% (filter-level)
- Memory overhead is ~100 bytes per subscription for filter storage
- Non-equality predicates (>, <, IN, LIKE) are not tracked — these subscriptions use table-level fallback
