export { schemaToVisualModel, visualModelToCode, generateDashboardHTML } from "./schema-visualizer.js"
export type {
  SchemaVisualModel,
  VisualTable,
  VisualColumn,
  VisualIndex,
  VisualRelation,
} from "./schema-visualizer.js"

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
