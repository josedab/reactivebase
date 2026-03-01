export {
  ConnectionHealthMonitor,
  CircuitBreaker,
  LatencyTracker,
  AdaptivePoolScaler,
  ReadReplicaRouter,
} from "./connection-health.js"
export type {
  CircuitState,
  ConnectionRole,
  ConnectionEndpoint,
  ConnectionHealthStats,
  HealthMonitorOptions,
  ScaleDecision,
  HealthAlert,
  HealthAlertHandler,
} from "./connection-health.js"
