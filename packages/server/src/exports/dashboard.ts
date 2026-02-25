// Dashboard & Schema Visualizer
export {
  schemaToVisualModel,
  visualModelToCode,
  generateDashboardHTML,
  generateFullDashboardHTML,
  generateAdminPanelHTML,
  generateAdminRoutes,
} from "../dashboard/index.js"
export {
  DashboardV2Engine,
  generateDashboardV2HTML,
  generateDashboardV2TableSQL,
  buildInsertMutationLogSQL,
  buildQueryMutationLogSQL,
  buildUpdateQueryStatsSQL,
  buildDataBrowserQuerySQL,
} from "../dashboard/index.js"
export { AdminStudio, buildDataBrowserSQL, buildCountSQL } from "../dashboard/index.js"
export type {
  SchemaVisualModel,
  VisualTable,
  VisualColumn,
  VisualRelation,
  AdminPanelOptions,
  AdminRoute,
} from "../dashboard/index.js"
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
} from "../dashboard/index.js"
export type {
  AdminStudioOptions,
  SchemaChange,
  MigrationPreview,
  DataBrowserQuery,
  DataBrowserFilterEntry,
  DataBrowserResponse,
  SubscriptionInspectorEntry,
  StudioMetricsSummary,
} from "../dashboard/index.js"

// Live Dashboard & Admin Panel
export {
  LiveDashboard,
  generateLiveDashboardTableSQL,
  buildInsertQueryLogSQL,
  buildInsertMutationTimelineSQL,
} from "../dashboard/index.js"
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
  LiveAdminRoute,
} from "../dashboard/index.js"
export type {
  Middleware,
  MiddlewareContext,
  MiddlewareResult,
  BeforeHook,
  AfterHook,
  ErrorHook,
} from "../middleware/index.js"

// Playground
export {
  PlaygroundEngine,
  PlaygroundError,
  generatePlaygroundHTML,
  generatePlaygroundTableSQL,
  buildSaveSessionSQL,
  buildLoadSessionSQL,
  buildListSessionsSQL,
  buildDeleteSessionSQL,
  PLAYGROUND_TEMPLATES,
  BUILTIN_TUTORIALS,
} from "../playground/index.js"
export { TutorialManager, INTERACTIVE_TUTORIALS } from "../playground/index.js"
export {
  LivePlaygroundEngine,
  encodeShareState,
  decodeShareState,
  generateLivePlaygroundHTML,
} from "../playground/index.js"
export { generateEmbeddableWidgetHTML, generateEmbedScript } from "../playground/index.js"
export { GuidedTutorialEngine, GUIDED_TUTORIALS } from "../playground/index.js"
export type {
  PlaygroundSession,
  ExecutionResult,
  TutorialDefinition,
  TutorialStep,
  PlaygroundOptions,
  PlaygroundContext,
  LogEntry,
  PlaygroundTemplate,
  PlaygroundHTMLOptions,
} from "../playground/index.js"
export type {
  InteractiveTutorial,
  TutorialStepDef,
  ValidationRule,
  StepValidationResult,
  PlaygroundShareState,
  ExportConfig,
  ExportResult,
} from "../playground/index.js"
export type { LivePlaygroundSession, ShareableState, PlaygroundWidget } from "../playground/index.js"
export type { GuidedTutorialDef, GuidedStepDef, GuidedTutorialSession, TutorialProgress } from "../playground/index.js"

// Visual Workflow Studio
export {
  WorkflowStudio,
  WorkflowValidator,
  WorkflowDebugger,
  WorkflowStudioError,
  builtInTemplates,
  buildCreateWorkflowStudioTablesSQL,
  buildUpsertDesignSQL,
  buildGetDesignSQL,
  buildInsertExecutionSQL as buildInsertWfExecutionSQL,
  buildUpdateExecutionSQL as buildUpdateWfExecutionSQL,
  buildInsertDebugSnapshotSQL,
} from "../workflow-studio/index.js"
export type {
  WorkflowNode,
  WorkflowNodeType,
  PortDefinition,
  WorkflowEdge,
  WorkflowDesign,
  WorkflowVariable,
  WorkflowTemplate,
  WorkflowExecution,
  NodeExecutionState,
  DebugBreakpoint,
  DebugSnapshot,
  WorkflowStudioOptions,
  ValidationError as WorkflowValidationError,
  MonitoringSnapshot,
} from "../workflow-studio/index.js"
