export { schemaToVisualModel, visualModelToCode, generateDashboardHTML } from "./schema-visualizer.js"
export type { SchemaVisualModel, VisualTable, VisualColumn, VisualIndex, VisualRelation } from "./schema-visualizer.js"

export { generateFullDashboardHTML } from "./full-dashboard.js"

// Admin Panel
export { generateAdminPanelHTML, generateAdminRoutes } from "./admin-panel.js"
export type { AdminPanelOptions, AdminRoute, DataBrowserColumn, QueryPlaygroundResult } from "./admin-panel.js"

// Dashboard v2: Query Inspector, Heatmap, Data Browser, Mutation Replay
export {
  DashboardV2Engine,
  generateDashboardV2HTML,
  generateDashboardV2TableSQL,
  buildInsertMutationLogSQL,
  buildQueryMutationLogSQL,
  buildUpdateQueryStatsSQL,
  buildDataBrowserQuerySQL,
} from "./query-inspector.js"
export type {
  QueryInspectorEntry,
  SubscriptionHeatmapEntry,
  DataBrowserOptions,
  DataBrowserFilter,
  DataBrowserResult,
  MutationReplayEntry,
  MutationReplayOptions,
  DashboardV2Metrics,
  DashboardV2Options,
} from "./query-inspector.js"

// Admin Studio: Schema Designer + Data Browser + Subscription Inspector
export { AdminStudio, buildDataBrowserSQL, buildCountSQL } from "./admin-studio.js"
export type {
  AdminStudioOptions,
  SchemaChange,
  MigrationPreview,
  DataBrowserQuery,
  DataBrowserFilterEntry,
  DataBrowserResponse,
  SubscriptionInspectorEntry,
  StudioMetricsSummary,
} from "./admin-studio.js"

// Migration Wizard UI
export { generateMigrationWizardHTML } from "./migration-wizard.js"

// Dashboard API Handler
export { createDashboardApiHandler } from "./dashboard-api.js"
export type { DashboardApiOptions, DashboardApiResponse, QueryExecutor } from "./dashboard-api.js"

// Live Dashboard
export {
  LiveDashboard,
  generateLiveDashboardTableSQL,
  buildInsertQueryLogSQL,
  buildInsertMutationTimelineSQL,
} from "./live-dashboard.js"
export type {
  LiveDashboardOptions,
  DashboardAuthConfig,
  QueryExecution,
  QuerySpan,
  MutationTimelineEntry,
  ActiveConnection,
  DashboardAlert,
  LiveDashboardMetrics,
  FlamechartData,
  FlamechartSpan,
  AdminRoute as LiveAdminRoute,
} from "./live-dashboard.js"
