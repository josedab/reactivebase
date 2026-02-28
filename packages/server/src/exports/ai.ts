// AI / RAG Pipeline
export { openaiProvider, ollamaProvider, mockAiProvider, createAiContext } from "../ai/index.js"
export type { AiProvider, AiContext, EmbedOptions, GenerateOptions, SearchOptions, SearchResult } from "../ai/index.js"

// AI Query Assistant
export { QueryAssistant } from "../ai-assistant/index.js"
export { SchemaGenerator } from "../ai-assistant/index.js"
export { QueryBuilderAssistant } from "../ai-assistant/index.js"
export { MigrationCopilot } from "../ai-assistant/index.js"
export type {
  QueryAssistantOptions,
  AiProviderAdapter,
  SchemaInfo,
  QueryGenerationResult,
  SchemaOptimization,
  QueryExplanation,
  AccessPattern,
} from "../ai-assistant/index.js"
export type { SchemaGenerationResult, SchemaAntiPattern } from "../ai-assistant/index.js"
export type { CompletionItem, ExplainPlanAnalysis, QueryOptimization } from "../ai-assistant/index.js"
export type {
  MigrationAnalysis,
  MigrationSafetyCheck,
  IndexOptimization,
  MigrationImpact as AiMigrationImpact,
  RollbackPlan,
} from "../ai-assistant/index.js"

// AI Schema & Query Copilot
export { SchemaCopilot, QueryBuilderAssistant as CopilotQueryBuilderAssistant } from "../ai/index.js"
export { CREATE_CONVERSATION_TABLE_SQL, buildUpsertConversationSql, buildLoadConversationSql } from "../ai/index.js"
export type {
  SchemaCopilotOptions,
  ConversationMessage,
  ConversationHistory,
  CopilotSchemaGenerationResult,
  IndexSuggestion as CopilotIndexSuggestion,
  MigrationResult,
  CopilotQueryExplanation,
  OptimizationSuggestion as CopilotOptimizationSuggestion,
} from "../ai/index.js"
