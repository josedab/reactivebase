// Connection Health Intelligence: monitoring, circuit breakers, adaptive scaling
export {
  ConnectionHealthMonitor,
  CircuitBreaker,
  LatencyTracker,
  AdaptivePoolScaler,
  ReadReplicaRouter,
} from "../connection-health/index.js"
export type {
  CircuitState,
  ConnectionRole,
  ConnectionEndpoint,
  ConnectionHealthStats,
  HealthMonitorOptions,
  ScaleDecision,
  HealthAlert,
  HealthAlertHandler,
} from "../connection-health/index.js"
