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
    expect(Array.isArray(builtInTemplates)).toBe(true)
    expect(builtInTemplates.length).toBeGreaterThan(0)
  })

  it("should test that templates contain valid workflow definitions", () => {
    for (const template of builtInTemplates) {
      expect(template.id).toBeTruthy()
      expect(template.name).toBeTruthy()
      expect(template.description).toBeTruthy()
      expect(template.category).toBeTruthy()
      expect(Array.isArray(template.tags)).toBe(true)
      expect(template.design).toBeDefined()
      expect(template.design.name).toBeTruthy()
      expect(Array.isArray(template.design.nodes)).toBe(true)
      expect(template.design.nodes.length).toBeGreaterThan(0)
      expect(Array.isArray(template.design.edges)).toBe(true)

      // Each node should have required properties
      for (const node of template.design.nodes) {
        expect(node.id).toBeTruthy()
        expect(node.type).toBeTruthy()
        expect(node.label).toBeTruthy()
        expect(node.position).toBeDefined()
      }
    }
  })

  it("should generate valid workflow studio tables SQL", () => {
    const sql = buildCreateWorkflowStudioTablesSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })

  it("should test SQL includes workflow design and execution tables", () => {
    const sql = buildCreateWorkflowStudioTablesSQL()
    const upper = sql.toUpperCase()
    expect(upper).toContain("_RB_WF_DESIGNS")
    expect(upper).toContain("_RB_WF_EXECUTIONS")
    expect(upper).toContain("_RB_WF_DEBUG_SNAPSHOTS")
    expect(upper).toContain("_RB_WF_TEMPLATES")
    expect(upper).toContain("WORKFLOW_ID")
    expect(upper).toContain("STATUS")
    expect(upper).toContain("NODE_STATES")
    expect(upper).toContain("VARIABLES")
    expect(upper).toContain("INDEX")
  })
})
