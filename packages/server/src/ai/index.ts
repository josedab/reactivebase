export { openaiProvider, ollamaProvider, mockAiProvider, createAiContext } from "./ai.js"
export type {
  AiProvider,
  AiContext,
  EmbedOptions,
  GenerateOptions,
  GenerateResult,
  SearchOptions,
  SearchResult,
} from "./ai.js"

export { SchemaCopilot, QueryBuilderAssistant } from "./schema-copilot.js"
export {
  CREATE_CONVERSATION_TABLE_SQL,
  buildUpsertConversationSql,
  buildLoadConversationSql,
} from "./schema-copilot.js"
export type {
  SchemaCopilotOptions,
  ConversationMessage,
  ConversationHistory,
  SchemaGenerationResult as CopilotSchemaGenerationResult,
  IndexSuggestion,
  MigrationResult,
  QueryExplanation as CopilotQueryExplanation,
  OptimizationSuggestion,
} from "./schema-copilot.js"
