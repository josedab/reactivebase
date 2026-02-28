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
} from "./playground.js"
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
} from "./playground.js"

// Interactive Tutorials
export { TutorialManager, INTERACTIVE_TUTORIALS } from "./tutorial-manager.js"
export type {
  InteractiveTutorial,
  TutorialStepDef,
  ValidationRule,
  StepValidationResult,
  PlaygroundShareState,
  ExportConfig,
  ExportResult,
} from "./tutorial-manager.js"

// Live Playground
export {
  LivePlaygroundEngine,
  encodeShareState,
  decodeShareState,
  generateLivePlaygroundHTML,
} from "./live-playground.js"
export type {
  LivePlaygroundSession,
  ShareableState,
  LivePlaygroundConfig,
  LiveExecutionResult,
  LivePlaygroundHTMLOptions,
} from "./live-playground.js"

// Embeddable Widget
export { generateEmbeddableWidgetHTML, generateEmbedScript } from "./embeddable-widget.js"
export type { PlaygroundWidget } from "./embeddable-widget.js"

// Guided Tutorials
export { GuidedTutorialEngine, GUIDED_TUTORIALS } from "./guided-tutorial.js"
export type {
  GuidedTutorialDef,
  GuidedStepDef,
  GuidedTutorialSession,
  StepSubmissionResult,
  TutorialProgress,
} from "./guided-tutorial.js"

// Schema Explorer & Interactive Tools
export {
  SchemaExplorer,
  AuthContextSwitcher,
  LiveQueryTester,
  SubscriptionDebugger,
  generateSchemaPlaygroundHTML,
} from "./schema-explorer.js"
export type {
  SchemaNode,
  ColumnInfo,
  IndexInfo,
  RelationInfo,
  SchemaVisualization,
  AuthContextProfile,
  LiveQueryTest,
  SubscriptionDebugEntry,
  SchemaDefinitionInput,
  SchemaPlaygroundHTMLOptions,
} from "./schema-explorer.js"
