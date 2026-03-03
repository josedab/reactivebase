export { WasmFunctionRuntime, WasmRuntimeError } from "./wasm-runtime.js"

export type {
  WasmRuntimeOptions,
  RuntimeTarget,
  WasmModule,
  ModuleMetadata,
  HostFunction,
  ExecutionContext,
  ExecutionResult,
  RuntimeStats,
  PortableBundle,
} from "./wasm-runtime.js"

// Sandbox & Runtime Adapters
export { WasmSandbox, createRuntimeAdapter, createWasmBuildConfig, buildWasmBundle } from "./sandbox-adapters.js"
export type {
  SandboxConfig,
  SandboxViolation,
  SandboxExecutionResult,
  RuntimeAdapter,
  RuntimeCapabilities,
  WasmBuildConfig,
  WasmBuildResult,
  WasmBuildOutput,
} from "./sandbox-adapters.js"
