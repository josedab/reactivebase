// Transport (for advanced usage)
export { TransportServer } from "../transport/index.js"
export type { ClientMessage, ServerMessage } from "../transport/index.js"

// SSE Transport & Protocol Negotiation
export { SseTransportServer, ProtocolNegotiator, EdgeSseStream, SseTransportError } from "../transport/index.js"
export type {
  SseTransportOptions,
  SseConnection,
  SseWritable,
  SseSubscriptionRequest,
  SseEvent,
  SseTransportStats,
  TransportProtocol,
  ProtocolNegotiatorOptions,
  NegotiationResult,
  EdgeSseOptions,
} from "../transport/index.js"

// Horizontal Scaling
export { ConsistentHashRing, ClusterManager } from "../scaling/index.js"
export type {
  ClusterNode,
  ClusterManagerOptions,
  ClusterMessage,
  InvalidationBroadcast,
  SubscriptionRoute,
  ClusterStats,
  DrainResult,
} from "../scaling/index.js"
export { SubscriptionShardManager } from "../scaling/index.js"
export type {
  ShardInfo,
  ShardManagerOptions,
  MigrationBatch,
  ShardAssignment,
  ShardMigrationState,
  ShardMigrationError,
  ShardStats,
  ShardManagerNode,
} from "../scaling/index.js"
