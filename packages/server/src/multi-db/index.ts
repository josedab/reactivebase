export {
  DatabaseFederation,
  FederationError,
  buildHealthCheckSQL,
  buildPoolStatsSQL,
  buildDatabaseInfoSQL,
} from "./multi-db.js"
export type {
  DatabaseConfig,
  FederationConfig,
  DatabaseInfo,
  CrossDatabaseQuery,
  FederatedQueryResult,
} from "./multi-db.js"
