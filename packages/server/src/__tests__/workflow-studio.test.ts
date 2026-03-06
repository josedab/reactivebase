import { describe, it, expect } from "vitest"
import {
  WorkflowStudio,
  WorkflowValidator,
  WorkflowDebugger,
  WorkflowStudioError,
  builtInTemplates,
  buildCreateWorkflowStudioTablesSQL,
  WorkflowCodeGenerator,
  StepTypeRegistry,
} from "../workflow-studio/index.js"

describe("workflow-studio", () => {
  it("should export all expected symbols", () => {
    expect(WorkflowStudio).toBeDefined()
    expect(WorkflowValidator).toBeDefined()
    expect(WorkflowDebugger).toBeDefined()
    expect(WorkflowStudioError).toBeDefined()
    expect(builtInTemplates).toBeDefined()
    expect(buildCreateWorkflowStudioTablesSQL).toBeDefined()
    expect(WorkflowCodeGenerator).toBeDefined()
    expect(StepTypeRegistry).toBeDefined()
  })

  it("should provide built-in templates", () => {
    // TODO: test that templates contain valid workflow definitions
    expect(Array.isArray(builtInTemplates)).toBe(true)
    expect(builtInTemplates.length).toBeGreaterThan(0)
  })

  it("should generate valid workflow studio tables SQL", () => {
    // TODO: test SQL includes workflow design and execution tables
    const sql = buildCreateWorkflowStudioTablesSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })
})
