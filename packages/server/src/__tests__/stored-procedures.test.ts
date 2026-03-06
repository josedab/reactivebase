import { describe, it, expect } from "vitest"
import {
  StoredProcedureRegistry,
  ProcedureBuilder,
  ProcedureCompileError,
  compileProcedure,
  defineProcedure,
  defineRawProcedure,
  createProcedureRegistry,
} from "../stored-procedures/index.js"

describe("stored-procedures", () => {
  it("should export all expected symbols", () => {
    expect(StoredProcedureRegistry).toBeDefined()
    expect(ProcedureBuilder).toBeDefined()
    expect(ProcedureCompileError).toBeDefined()
    expect(compileProcedure).toBeDefined()
    expect(defineProcedure).toBeDefined()
    expect(defineRawProcedure).toBeDefined()
    expect(createProcedureRegistry).toBeDefined()
  })

  it("should create a ProcedureRegistry via factory", () => {
    // TODO: test registering and retrieving stored procedures
    const registry = createProcedureRegistry()
    expect(registry).toBeInstanceOf(StoredProcedureRegistry)
  })

  it("should throw ProcedureCompileError with correct message", () => {
    // TODO: test compilation error details for invalid procedure definitions
    const error = new ProcedureCompileError("test_proc", "compile error")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("compile error")
  })
})
