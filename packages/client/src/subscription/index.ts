export { ReactiveBaseClient } from "./subscription-manager.js"
export type { SubscriptionHandle, ReactiveBaseClientOptions, QueryListener } from "./subscription-manager.js"

// Client Subscription Middleware
export {
  ClientMiddlewarePipeline,
  loggingMiddleware,
  retryMiddleware,
  analyticsMiddleware,
} from "./client-middleware.js"
export type {
  ClientSubscriptionMiddleware,
  SubscriptionEvent,
  SubscriptionUpdateEvent,
  SubscriptionErrorEvent,
  SubscriptionStaleEvent,
  SubscriptionReconnectEvent,
  AnalyticsMetric,
} from "./client-middleware.js"
