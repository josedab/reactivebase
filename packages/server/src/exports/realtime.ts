// Pub/Sub
export { RedisPubSubAdapter, InMemoryPubSubAdapter } from "../pubsub/index.js"
export type { PubSubAdapter, RedisPubSubOptions, RedisLike } from "../pubsub/index.js"

// Webhooks
export {
  WebhookRegistry,
  OutboundWebhookManager,
  defineWebhook,
  parseNotifyPayload,
  generateNotifyTriggerSQL,
} from "../webhooks/index.js"
export type { WebhookDefinition, WebhookResult, OutboundWebhook } from "../webhooks/index.js"

// Event Streaming
export {
  EventStreamManager,
  KafkaStreamAdapter,
  NatsStreamAdapter,
  SqsStreamAdapter,
  generateEventStreamTableSQL,
  buildInsertDeadLetterSQL,
} from "../webhooks/index.js"
export type {
  EventStreamAdapter,
  StreamEvent,
  PublishResult,
  EventFilter,
  EventTransform,
  RetryPolicy,
  DeadLetterConfig,
  EventStreamManagerOptions,
  KafkaAdapterOptions,
  NatsAdapterOptions,
  SqsAdapterOptions,
} from "../webhooks/index.js"

// Presence & Collaboration
export {
  PresenceManager,
  buildIncrementSQL,
  buildArrayAppendSQL,
  buildArrayRemoveSQL,
  buildJsonMergeSQL,
} from "../presence/index.js"
export type { PresenceData, PresenceOptions, PresenceListener } from "../presence/index.js"

// CRDT Engine
export {
  CrdtEngine,
  CrdtDocumentHandle,
  CrdtError,
  generateCrdtTableSQL,
  buildUpsertDocumentSQL,
  buildInsertOperationSQL,
  buildGetDocumentSQL,
  buildGetOperationsSinceSQL,
  buildCompactOperationsSQL,
} from "../crdt/index.js"
export type {
  CrdtOperation,
  CrdtType,
  CrdtDocument,
  CrdtEngineOptions,
  CrdtSnapshot,
  LwwRegisterOp,
  GCounterOp,
  PnCounterOp,
  OrSetOp,
  RgaOp,
} from "../crdt/index.js"

// Collaboration Primitives
export { CollaborationManager } from "../collaboration/index.js"
export { createCollabContext } from "../collaboration/index.js"
export type { CollabContextOptions, CollabText, CollabList, CollabMap, CollabCounter } from "../collaboration/index.js"
export {
  DocumentCollaboration,
  generateCollabDocTableSQL,
  buildInsertDocumentSQL,
  buildInsertUpdateSQL,
} from "../collaboration/index.js"
export {
  writeVarUint,
  readVarUint,
  writeVarBytes,
  readVarBytes,
  writeVarString,
  readVarString,
  encodeStateVector,
  decodeStateVector,
  encodeUpdate,
  decodeUpdate,
  createSyncStep1,
  createSyncStep2,
  createUpdateMessage,
  parseSyncMessage,
  encodeAwarenessUpdate,
  decodeAwarenessUpdate,
  mergeUpdates,
  computeMissingUpdates,
  computeStateDiff,
  hashClientId,
  YjsSyncMessageType,
  YjsAwarenessMessageType,
} from "../collaboration/index.js"
export type {
  CursorPosition,
  SelectionRange,
  UserAwareness,
  RoomAwarenessState,
  CollaborationOptions,
  AwarenessListener,
} from "../collaboration/index.js"
export type {
  CollaborativeDocument,
  DocumentType,
  DocumentUpdate,
  DocumentSnapshot,
  UndoEntry,
  DocumentAwareness,
  DocumentCollaborationOptions,
  DocumentStats,
} from "../collaboration/index.js"
export type {
  StateVector,
  YjsUpdate,
  SyncMessage,
  AwarenessMessage,
  AwarenessClientState,
  MergeResult,
} from "../collaboration/index.js"

// Multiplayer Collaboration Kit
export {
  MultiplayerKit,
  CrdtDocument as MultiplayerCrdtDocument,
  PresenceTracker,
  CursorManager,
  MultiplayerError,
  incrementVectorClock,
  mergeVectorClocks as mergeMultiplayerClocks,
  buildCreateMultiplayerTablesSQL,
  buildInsertRoomSQL,
  buildUpsertPermissionSQL,
  buildGetPermissionSQL,
  buildInsertOperationSQL as buildInsertMpOperationSQL,
  buildGetOperationsSinceSQL as buildGetMpOperationsSinceSQL,
} from "../multiplayer/index.js"
export type {
  MultiplayerUser,
  CursorPosition as MultiplayerCursorPosition,
  PresenceState,
  SelectionRange as MultiplayerSelectionRange,
  MultiplayerPermission,
  MultiplayerRoom,
  MultiplayerEvent,
  CrdtOperation as MultiplayerCrdtOperation,
  MultiplayerKitOptions,
  RoomStats,
} from "../multiplayer/index.js"

// Event Sourcing & CQRS
export {
  EventStore,
  ProjectionEngine,
  EventSourcingError,
  buildCreateEventStoreTablesSQL,
  buildAppendEventSQL,
  buildGetEventsSQL as buildGetEsEventsSQL,
  buildGetEventsByFilterSQL,
  buildUpsertStreamSQL,
  buildSaveSnapshotSQL,
  buildGetLatestSnapshotSQL,
  buildUpsertProjectionSQL,
} from "../event-sourcing/index.js"
export type {
  DomainEvent,
  EventMetadata,
  EventStream,
  Snapshot,
  Projection,
  ProjectionState,
  EventFilter as EventSourcingFilter,
  EventStoreOptions,
  AppendResult,
  ReplaySession,
  CommandHandler,
  ReadModel,
  EventStoreStats,
} from "../event-sourcing/index.js"

// Reactive File & Media Pipeline
export {
  MediaPipeline,
  TransformBuilder,
  ReactiveUrlBuilder,
  UploadValidator,
  MediaPipelineError,
  transformPresets,
  buildCreateMediaTablesSQL,
  buildInsertFileSQL,
  buildGetFileSQL,
  buildListFilesSQL,
  buildInsertVariantSQL,
  buildGetVariantsSQL,
  buildDeleteFileSQL,
} from "../media-pipeline/index.js"
export type {
  MediaFile,
  MediaMetadata,
  MediaVariant,
  ImageTransform,
  VideoTransform,
  WatermarkConfig,
  UploadOptions,
  UploadResult,
  CdnConfig,
  SignedUrlOptions,
  MediaPipelineOptions,
  MediaPipelineStats,
} from "../media-pipeline/index.js"

// Webhook Delivery Queue & Integration Bus
export {
  WebhookDeliveryQueue,
  WebhookSimulator,
  WebhookDeliveryError,
  webhookTemplates,
  generateDeliveryQueueTableSQL,
  createDeliveryQueue,
  createWebhookSimulator,
} from "../webhooks/index.js"
export type {
  DeliveryRecord,
  DeliveryStatus,
  DeliveryQueueOptions,
  DeliveryMetrics,
  WebhookTemplate,
  SimulatedDelivery,
} from "../webhooks/index.js"
