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
    const registry = createProcedureRegistry()
    expect(registry).toBeInstanceOf(StoredProcedureRegistry)
  })

  it.todo("should test registering and retrieving stored procedures")

  it("should throw ProcedureCompileError with correct message", () => {
    const error = new ProcedureCompileError("test_proc", "compile error")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("compile error")
  })

  it.todo("should test compilation error details for invalid procedure definitions")
})
