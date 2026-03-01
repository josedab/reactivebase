export { MockDatabase } from "./mock-database.js"
export type { MockRow, MockDatabaseContext } from "./mock-database.js"

export { TestServer, createTestServer } from "./test-server.js"
export type { TestServerOptions, QueryTestResult, MutationTestResult, ReactiveSnapshot } from "./test-server.js"

// Snapshot Testing & Time-Travel Debugging
export { SnapshotManager, replayMutations, assertSnapshotMatches, assertDiffContains } from "./snapshot-testing.js"
export type {
  NamedSnapshot,
  StateDiff,
  TableDiff,
  MutationReplayEntry,
  ReplayResult,
  MutationStep,
  MutationRunner,
} from "./snapshot-testing.js"
