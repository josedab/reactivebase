export {
  EventStore,
  ProjectionEngine,
  EventSourcingError,
  buildCreateEventStoreTablesSQL,
  buildAppendEventSQL,
  buildGetEventsSQL,
  buildGetEventsByFilterSQL,
  buildUpsertStreamSQL,
  buildSaveSnapshotSQL,
  buildGetLatestSnapshotSQL,
  buildUpsertProjectionSQL,
} from "./event-sourcing.js"

export type {
  DomainEvent,
  EventMetadata,
  EventStream,
  Snapshot,
  Projection,
  ProjectionState,
  EventFilter,
  EventStoreOptions,
  AppendResult,
  ReplaySession,
  CommandHandler,
  ReadModel,
  EventStoreStats,
} from "./event-sourcing.js"
