// Functions
export { query, mutation, action } from "../functions/index.js"
export type {
  FunctionContext,
  RegisteredFunction,
  QueryOptions,
  MutationOptions,
  ActionOptions,
  SchedulerContext,
  LogContext,
} from "../functions/index.js"

// Structured Errors
export {
  ReactiveBaseError,
  ReadOnlyError,
  RecordNotFoundError,
  FunctionNotFoundError,
  NotQueryFunctionError,
  CircularDependencyError,
  EmitOutsideMutationError,
  QueryContextRequiredError,
  InvalidMessageError,
  SchemaValidationError,
} from "../errors.js"

// Type-Safe RPC Code Splitting
export {
  LazyFunctionRegistry,
  RpcSplitError,
  generateFunctionManifest,
  computeChunks,
  generateClientProxy,
} from "../rpc-splitting/index.js"
export type {
  FunctionManifestEntry,
  FunctionManifest,
  ChunkDefinition,
  SplitConfig,
  LazyFunctionOptions,
  FunctionLoader,
  InvokeResult,
  RegistryStats as RpcRegistryStats,
} from "../rpc-splitting/index.js"

// Portable Function Runtime (Wasm)
export { WasmFunctionRuntime, WasmRuntimeError } from "../wasm-runtime/index.js"
export type {
  WasmRuntimeOptions,
  RuntimeTarget,
  WasmModule,
  ModuleMetadata,
  HostFunction,
  ExecutionContext as WasmExecutionContext,
  ExecutionResult as WasmExecutionResult,
  RuntimeStats as WasmRuntimeStats,
  PortableBundle,
} from "../wasm-runtime/index.js"
