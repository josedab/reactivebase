export {
  scanFunctions,
  groupByModule,
  generateApiModule,
  generateServerModule,
  generateDataModel,
  generate,
} from "./codegen.js"
export type { ScannedFunction, GenerateResult } from "./codegen.js"

// Enhanced Typed Codegen
export {
  TypedCodegen,
  extractFunctionTypes,
  parseSchemaSource,
  generateTypedApiModule,
  generateTypedDbContext,
} from "./typed-codegen.js"
export type {
  TypedFunctionInfo,
  SchemaField,
  SchemaTable,
  ParsedSchema,
  TypedCodegenOptions,
  TypedGenerateResult,
  WatchEvent,
} from "./typed-codegen.js"

// RPC Type Generator
export { RpcTypeGenerator, schemaToTypeScript, schemaToValidationCode } from "./rpc-types.js"
export type { RpcFunctionDef, RpcSchema, RpcGenerateOutput, RpcClientSdkConfig, FileHashEntry } from "./rpc-types.js"

// Schema Completion Provider (TS Language Server)
export { SchemaCompletionProvider } from "./schema-completion.js"
export type { CompletionItem, HoverInfo, DiagnosticInfo, DefinitionLocation } from "./schema-completion.js"
