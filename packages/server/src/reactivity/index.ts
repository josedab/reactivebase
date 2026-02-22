export { SubscriptionRegistry } from "./subscription-registry.js"
export type { Subscription } from "./subscription-registry.js"
export { InvalidationEvaluator } from "./invalidation-evaluator.js"
export type { ChangeEvent, InvalidationResult, InvalidationLevel } from "./invalidation-evaluator.js"
export { hashResult, hasResultChanged, computeDiff } from "./result-differ.js"
export type { ResultDiff } from "./result-differ.js"
export { ReactivityEngine } from "./reactivity-engine.js"
export type { ReactivityEngineOptions, SubscriptionUpdate, UpdateCallback } from "./reactivity-engine.js"

// Row-Level Tracking (Level 3)
export {
  RowLevelTracker,
  BloomFilter,
  generateRowTrackingTableSQL,
  buildUpsertRowTrackingSQL,
  buildDeleteRowTrackingSQL,
  buildGetAffectedSubscriptionsSQL,
} from "./row-level-tracker.js"
export type {
  RowLevelTrackerOptions,
  RowTrackingState,
  RowInvalidationResult,
  RowLevelStats,
} from "./row-level-tracker.js"
