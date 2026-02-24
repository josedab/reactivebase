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

// Database Adapter Layer
export {
  createPostgresAdapter,
  createSQLiteAdapter,
  createMySQLAdapter,
  postgresTranslator,
  sqliteTranslator,
  mysqlTranslator,
  getTranslator,
  translateColumnType,
  translateCreateTable,
  DatabaseAdapterError,
} from "./database-adapter.js"
export type {
  DatabaseAdapter,
  DatabaseDialect,
  TransactionHandle,
  DatabaseAdapterInfo,
  SQLTranslator,
  PostgresAdapterOptions,
  SQLiteAdapterOptions,
  MySQLAdapterOptions,
} from "./database-adapter.js"

// Federation Extensions (defineDataSource, cross-source, reactive federation)
export { defineDataSource, mergeQueryResults, FederationChangeRelay, ReplicaRouter } from "./federation.js"
export type {
  DataSourceConfig,
  DataSourceSchema,
  FederatedDataSource,
  MergedQueryResult,
  ChangeNotification,
  ChangeNotificationHandler,
} from "./federation.js"
