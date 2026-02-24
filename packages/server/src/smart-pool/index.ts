export {
  SmartPool,
  QueryDeduplicator,
  AdaptivePoolSizer,
  SubscriptionCoalescer,
  BatchInvalidationEvaluator,
  BackpressureError,
  PoolExhaustedError,
  createSmartPool,
  createQueryDeduplicator,
  createSubscriptionCoalescer,
} from "./smart-pool.js"
export type { SmartPoolOptions, CoalescedQuery, QueryResult, PoolStats, BatchEvaluatorOptions } from "./smart-pool.js"
