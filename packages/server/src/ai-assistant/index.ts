export { QueryAssistant } from "./ai-assistant.js"
export type {
  QueryAssistantOptions,
  AiProviderAdapter,
  SchemaInfo,
  QueryGenerationResult,
  SchemaOptimization,
  QueryExplanation,
  AccessPattern,
} from "./ai-assistant.js"

export { SchemaGenerator } from "./schema-generator.js"
export type {
  SchemaGenerationResult,
  GeneratedTable,
  GeneratedRelation,
  GeneratedIndex,
  SchemaAntiPattern,
  MigrationStep,
  MigrationStrategy,
  SchemaGeneratorOptions,
} from "./schema-generator.js"

export { QueryBuilderAssistant } from "./query-builder.js"
export type {
  CompletionItem,
  ExplainPlanAnalysis,
  IndexUsageInfo,
  QueryOptimization,
  TestCase,
  QueryBuilderAssistantOptions,
} from "./query-builder.js"

export { MigrationCopilot } from "./migration-copilot.js"
export type {
  MigrationAnalysis,
  MigrationIssue,
  MigrationSafetyCheck,
  IndexOptimization,
  MigrationImpact,
  RollbackPlan,
  RollbackStep,
  SafeMigrationStrategy,
  MigrationPhase,
  MigrationCopilotOptions,
} from "./migration-copilot.js"

// Production-Grade Conversation Engine
export {
  ConversationEngine,
  ConversationSessionHandle,
  ollamaProvider,
  checkGuardrails,
} from "./conversation-engine.js"
export type {
  ConversationEngineOptions,
  ConversationMessage,
  ConversationSession,
  StreamChunk,
  GuardrailResult,
  CostSummary,
  OllamaProviderOptions,
} from "./conversation-engine.js"
