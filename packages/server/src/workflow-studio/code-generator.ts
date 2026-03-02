// --------------------------------------------------------------------------
// Workflow Code Generator & Execution Visualizer
// Compiles visual WorkflowDesign to executable TypeScript code,
// provides a registry for step types, and tracks execution for UI rendering
// --------------------------------------------------------------------------

import type {
  WorkflowDesign,
  WorkflowNode,
  WorkflowVariable,
  WorkflowExecution,
  NodeExecutionState,
} from "./workflow-studio.js"

// ── Types ──────────────────────────────────────────────────────────────────

/** Generated TypeScript code output from the code generator */
export interface GeneratedCode {
  /** Full TypeScript source for the workflow */
  typescript: string
  /** Generated interface definitions */
  types: string
  /** Step-by-step code fragments keyed by node ID */
  stepFragments: Map<string, string>
  /** Warnings produced during generation */
  warnings: string[]
}

/** Definition of a step type in the registry */
export interface StepTypeDefinition {
  /** Unique step type name */
  name: string
  /** Human-readable label */
  label: string
  /** Description of the step type */
  description: string
  /** JSON Schema for step inputs */
  inputSchema: StepInput
  /** JSON Schema for step outputs */
  outputSchema: StepOutput
  /** TypeScript code template with `{{input}}` and `{{config}}` placeholders */
  codeTemplate: string
}

/** Schema definition for step inputs */
export interface StepInput {
  type: "object"
  properties: Record<string, { type: string; description?: string; required?: boolean }>
}

/** Schema definition for step outputs */
export interface StepOutput {
  type: "object"
  properties: Record<string, { type: string; description?: string }>
}

/** Timeline of execution events for the UI */
export interface ExecutionTimeline {
  executionId: string
  workflowId: string
  entries: TimelineEntry[]
  totalDurationMs: number
}

/** Single entry in the execution timeline */
export interface TimelineEntry {
  nodeId: string
  nodeLabel: string
  status: NodeExecutionState["status"]
  startedAt: number | null
  completedAt: number | null
  durationMs: number | null
  error?: string
  retryCount: number
}

/** Node in the execution graph with visual status info */
export interface ExecutionGraphNode {
  nodeId: string
  label: string
  type: string
  status: NodeExecutionState["status"]
  statusColor: string
  durationMs: number | null
  error?: string
  children: string[]
}

/** Entry in the audit log for compliance/debugging */
export interface AuditLogEntry {
  timestamp: number
  nodeId: string
  nodeLabel: string
  event: "started" | "completed" | "failed" | "skipped" | "retried"
  durationMs: number | null
  input?: unknown
  output?: unknown
  error?: string
}

// ── Step Type Registry ─────────────────────────────────────────────────────

/**
 * Registry for workflow step type handlers.
 *
 * Each step type defines its schema and code template used during generation.
 * Built-in types are registered automatically; custom types can be added at
 * runtime via `registerStepType()`.
 *
 * @example
 * ```ts
 * const registry = new StepTypeRegistry()
 * registry.registerStepType({
 *   name: "slack-notify",
 *   label: "Slack Notification",
 *   description: "Send a Slack message",
 *   inputSchema: { type: "object", properties: { channel: { type: "string" } } },
 *   outputSchema: { type: "object", properties: { messageId: { type: "string" } } },
 *   codeTemplate: 'await slack.send({{config}}.channel, {{input}})',
 * })
 * ```
 */
export class StepTypeRegistry {
  private types = new Map<string, StepTypeDefinition>()

  constructor() {
    this.registerBuiltIns()
  }

  /** Register a custom step type definition */
  registerStepType(definition: StepTypeDefinition): void {
    this.types.set(definition.name, definition)
  }

  /** Retrieve a step type by name, or `undefined` if not found */
  getStepType(name: string): StepTypeDefinition | undefined {
    return this.types.get(name)
  }

  /** List all registered step types */
  listStepTypes(): StepTypeDefinition[] {
    return Array.from(this.types.values())
  }

  private registerBuiltIns(): void {
    this.types.set("query", {
      name: "query",
      label: "Database Query",
      description: "Execute a read-only database query",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "SQL query to execute", required: true },
          params: { type: "array", description: "Query parameters" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          rows: { type: "array", description: "Query result rows" },
        },
      },
      codeTemplate: `const {{stepVar}} = await wf.step("{{stepName}}", async () => {\n  return await db.query({{config}}.sql, {{config}}.params)\n})`,
    })

    this.types.set("mutation", {
      name: "mutation",
      label: "Database Mutation",
      description: "Execute a database write operation",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "SQL mutation to execute", required: true },
          params: { type: "array", description: "Mutation parameters" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          rowCount: { type: "number", description: "Number of affected rows" },
        },
      },
      codeTemplate: `const {{stepVar}} = await wf.step("{{stepName}}", async () => {\n  return await db.mutate({{config}}.sql, {{config}}.params)\n})`,
    })

    this.types.set("action", {
      name: "action",
      label: "External Action",
      description: "Call an external service or function",
      inputSchema: {
        type: "object",
        properties: {
          handler: { type: "string", description: "Action handler name", required: true },
          payload: { type: "object", description: "Action payload" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          result: { type: "object", description: "Action result" },
        },
      },
      codeTemplate: `const {{stepVar}} = await wf.step("{{stepName}}", async () => {\n  return await actions.execute({{config}}.handler, {{config}}.payload)\n})`,
    })

    this.types.set("condition", {
      name: "condition",
      label: "Condition",
      description: "Branch execution based on a condition expression",
      inputSchema: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Boolean expression to evaluate", required: true },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          result: { type: "boolean", description: "Evaluation result" },
        },
      },
      codeTemplate: `if ({{config}}.expression) {\n  {{trueBranch}}\n} else {\n  {{falseBranch}}\n}`,
    })

    this.types.set("parallel", {
      name: "parallel",
      label: "Parallel Execution",
      description: "Run multiple branches in parallel using Promise.all",
      inputSchema: {
        type: "object",
        properties: {
          branches: { type: "array", description: "Branch definitions to run in parallel" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", description: "Results from each branch" },
        },
      },
      codeTemplate: `const {{stepVar}} = await wf.step("{{stepName}}", async () => {\n  return await Promise.all([\n    {{branches}}\n  ])\n})`,
    })

    this.types.set("delay", {
      name: "delay",
      label: "Delay",
      description: "Pause execution for a specified duration",
      inputSchema: {
        type: "object",
        properties: {
          duration: { type: "string", description: "Duration string (e.g. '5m', '1h')", required: true },
        },
      },
      outputSchema: {
        type: "object",
        properties: {},
      },
      codeTemplate: `await wf.sleep("{{stepName}}", "{{duration}}")`,
    })

    this.types.set("human-approval", {
      name: "human-approval",
      label: "Human Approval",
      description: "Wait for a human approval event before continuing",
      inputSchema: {
        type: "object",
        properties: {
          event: { type: "string", description: "Event name to wait for", required: true },
          timeout: { type: "string", description: "Timeout duration (e.g. '24h')" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          approved: { type: "boolean", description: "Whether the request was approved" },
          approver: { type: "string", description: "Who approved the request" },
        },
      },
      codeTemplate: `const {{stepVar}} = await wf.waitForEvent("{{event}}")`,
    })
  }
}

// ── Workflow Code Generator ────────────────────────────────────────────────

/**
 * Compiles a visual WorkflowDesign into executable TypeScript code
 * that uses the `defineWorkflow()` API.
 *
 * @example
 * ```ts
 * const generator = new WorkflowCodeGenerator()
 * const design = studio.getDesign("my-workflow")!
 * const code = generator.generateTypeScript(design)
 *
 * console.log(code.typescript)  // Full defineWorkflow() code
 * console.log(code.types)       // TypeScript interfaces
 * ```
 */
export class WorkflowCodeGenerator {
  private registry: StepTypeRegistry

  constructor(registry?: StepTypeRegistry) {
    this.registry = registry ?? new StepTypeRegistry()
  }

  /**
   * Generate complete TypeScript code for a workflow design.
   *
   * Produces a `defineWorkflow()` call with all steps, conditions,
   * and parallel branches derived from the visual graph.
   */
  generateTypeScript(design: WorkflowDesign): GeneratedCode {
    const warnings: string[] = []
    const stepFragments = new Map<string, string>()

    const types = this.generateWorkflowTypes(design)

    // Build adjacency for topological ordering
    const adjacency = new Map<string, string[]>()
    const inDegree = new Map<string, number>()
    for (const node of design.nodes) {
      adjacency.set(node.id, [])
      inDegree.set(node.id, 0)
    }
    for (const edge of design.edges) {
      adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId)
      inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1)
    }

    // Topological sort (Kahn's algorithm)
    const sorted: WorkflowNode[] = []
    const queue = design.nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    const visited = new Set<string>()

    while (queue.length > 0) {
      const node = queue.shift()!
      if (visited.has(node.id)) continue
      visited.add(node.id)
      sorted.push(node)

      for (const neighborId of adjacency.get(node.id) ?? []) {
        inDegree.set(neighborId, (inDegree.get(neighborId) ?? 0) - 1)
        if ((inDegree.get(neighborId) ?? 0) <= 0) {
          const neighbor = design.nodes.find((n) => n.id === neighborId)
          if (neighbor && !visited.has(neighbor.id)) queue.push(neighbor)
        }
      }
    }

    // Detect nodes not reachable (cycle members)
    for (const node of design.nodes) {
      if (!visited.has(node.id)) {
        warnings.push(`Node "${node.label}" (${node.id}) is part of a cycle and was skipped`)
      }
    }

    // Generate step code for each node in order
    const stepLines: string[] = []
    for (const node of sorted) {
      const code = this.generateStepCode(node)
      stepFragments.set(node.id, code)
      if (code) {
        stepLines.push(code)
      }
    }

    // Assemble the variables type
    const varsParam = design.variables.length > 0 ? `args: ${design.name.replace(/[^a-zA-Z0-9]/g, "")}Input` : ""

    const body = stepLines.map((l) => `    ${l}`).join("\n\n")

    const typescript = [
      `import { defineWorkflow } from "reactivebase"`,
      "",
      types,
      "",
      `const ${this.toVarName(design.name)} = defineWorkflow("${this.escapeString(design.name)}", async (wf${varsParam ? `, ${varsParam}` : ""}) => {`,
      body,
      `})`,
      "",
      `export default ${this.toVarName(design.name)}`,
    ].join("\n")

    return { typescript, types, stepFragments, warnings }
  }

  /**
   * Generate TypeScript code for an individual workflow node.
   *
   * Maps visual node types to their corresponding step type code templates.
   * Returns an empty string for trigger nodes (they are entry points only).
   */
  generateStepCode(node: WorkflowNode): string {
    const stepName = this.toStepName(node.label)
    const stepVar = this.toVarName(node.label)

    switch (node.type) {
      case "trigger":
        // Triggers are entry points; no executable code
        return ""

      case "action":
      case "http":
      case "custom":
        return this.fromTemplate("action", stepName, stepVar, node.config)

      case "database":
        return this.fromTemplate(
          node.config.operation === "write" ? "mutation" : "query",
          stepName,
          stepVar,
          node.config,
        )

      case "condition":
        return this.generateConditionCode(node)

      case "parallel":
        return this.generateParallelCode(node)

      case "delay":
        return this.generateDelayCode(node)

      case "loop":
        return this.generateLoopCode(node)

      case "transform":
        return `const ${stepVar} = await wf.step("${stepName}", async () => {\n      return transform(${JSON.stringify(node.config.mapping ?? {})})\n    })`

      case "notification":
        return `await wf.step("${stepName}", async () => {\n      await notify(${JSON.stringify(node.config)})\n    })`

      default:
        return `// FIXME(workflow-studio): unsupported node type "${node.type}" for "${node.label}" — please file an issue`
    }
  }

  /**
   * Generate TypeScript interface definitions for a workflow design.
   *
   * Produces input/output types based on declared workflow variables.
   */
  generateWorkflowTypes(design: WorkflowDesign): string {
    const safeName = design.name.replace(/[^a-zA-Z0-9]/g, "")
    const lines: string[] = []

    // Input type from variables
    if (design.variables.length > 0) {
      lines.push(`export interface ${safeName}Input {`)
      for (const v of design.variables) {
        const tsType = this.variableTypeToTS(v.type)
        const optional = v.defaultValue !== undefined ? "?" : ""
        if (v.description) {
          lines.push(`  /** ${v.description} */`)
        }
        lines.push(`  ${v.name}${optional}: ${tsType}`)
      }
      lines.push(`}`)
    }

    // Output type from terminal nodes
    lines.push("")
    lines.push(`export interface ${safeName}Output {`)
    lines.push(`  success: boolean`)
    lines.push(`  result?: unknown`)
    lines.push(`}`)

    return lines.join("\n")
  }

  private fromTemplate(typeName: string, stepName: string, stepVar: string, config: Record<string, unknown>): string {
    const stepType = this.registry.getStepType(typeName)
    if (!stepType) return `// Unknown step type: ${typeName}`

    return stepType.codeTemplate
      .replace(/\{\{stepName\}\}/g, stepName)
      .replace(/\{\{stepVar\}\}/g, stepVar)
      .replace(/\{\{config\}\}/g, JSON.stringify(config))
  }

  private generateConditionCode(node: WorkflowNode): string {
    const expression = (node.config.expression as string) ?? "true"
    this.validateSafeExpression(expression)
    return `if (${expression}) {\n      // true branch for "${node.label}"\n    } else {\n      // false branch for "${node.label}"\n    }`
  }

  private generateParallelCode(node: WorkflowNode): string {
    const stepVar = this.toVarName(node.label)
    const stepName = this.toStepName(node.label)
    return `const ${stepVar} = await wf.step("${stepName}", async () => {\n      return await Promise.all([\n        // parallel branches for "${node.label}"\n      ])\n    })`
  }

  private generateDelayCode(node: WorkflowNode): string {
    const stepName = this.toStepName(node.label)
    const duration = (node.config.duration as string) ?? (node.config.delay as string) ?? "1m"
    return `await wf.sleep("${stepName}", "${this.escapeString(duration)}")`
  }

  private generateLoopCode(node: WorkflowNode): string {
    const expression = (node.config.expression as string) ?? "items"
    this.validateSafeExpression(expression)
    const stepVar = this.toVarName(node.label)
    return `const ${stepVar} = []\n    for (const item of ${expression}) {\n      // loop body for "${node.label}"\n    }`
  }

  /** Reject expressions containing dangerous patterns (imports, require, process, eval, Function) */
  private validateSafeExpression(expression: string): void {
    const dangerous =
      /\b(import|require|process|eval|Function|globalThis|__proto__|constructor)\b|[;{}]|\bexec\s*\(|\bchild_process\b/
    if (dangerous.test(expression)) {
      throw new Error(`Unsafe expression rejected: ${expression.substring(0, 60)}`)
    }
  }

  private toVarName(label: string): string {
    return label
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim()
      .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^\w/, (c) => c.toLowerCase())
  }

  private toStepName(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-")
  }

  private escapeString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  }

  private variableTypeToTS(type: WorkflowVariable["type"]): string {
    switch (type) {
      case "string":
        return "string"
      case "number":
        return "number"
      case "boolean":
        return "boolean"
      case "object":
        return "Record<string, unknown>"
      case "array":
        return "unknown[]"
      default:
        return "unknown"
    }
  }
}

// ── Execution Visualizer ───────────────────────────────────────────────────

/**
 * Tracks workflow execution state for UI rendering and audit purposes.
 *
 * Transforms raw WorkflowExecution data into visual-friendly structures:
 * timelines, colored graphs, node metrics, and audit logs.
 *
 * @example
 * ```ts
 * const visualizer = new ExecutionVisualizer()
 * const execution = studio.getExecution(executionId)!
 * const design = studio.getDesign(execution.workflowId)!
 *
 * const timeline = visualizer.getExecutionTimeline(execution)
 * const graph = visualizer.getExecutionGraph(design, execution)
 * const audit = visualizer.getAuditLog(execution)
 * ```
 */
export class ExecutionVisualizer {
  private static readonly STATUS_COLORS: Record<NodeExecutionState["status"], string> = {
    pending: "#9ca3af",
    running: "#3b82f6",
    completed: "#22c55e",
    failed: "#ef4444",
    skipped: "#a3a3a3",
  }

  /**
   * Returns an ordered timeline of node executions for rendering a
   * horizontal or vertical timeline in the UI.
   */
  getExecutionTimeline(execution: WorkflowExecution): ExecutionTimeline {
    const entries: TimelineEntry[] = []

    for (const [, state] of execution.nodeStates) {
      entries.push({
        nodeId: state.nodeId,
        nodeLabel: state.nodeId,
        status: state.status,
        startedAt: state.startedAt ?? null,
        completedAt: state.completedAt ?? null,
        durationMs: state.startedAt && state.completedAt ? state.completedAt - state.startedAt : null,
        error: state.error,
        retryCount: state.retryCount,
      })
    }

    // Sort by start time, pending nodes last
    entries.sort((a, b) => {
      if (a.startedAt === null && b.startedAt === null) return 0
      if (a.startedAt === null) return 1
      if (b.startedAt === null) return -1
      return a.startedAt - b.startedAt
    })

    const totalDurationMs = execution.completedAt
      ? execution.completedAt - execution.startedAt
      : Date.now() - execution.startedAt

    return { executionId: execution.id, workflowId: execution.workflowId, entries, totalDurationMs }
  }

  /**
   * Returns the execution graph with status colors for each node.
   *
   * Merges the static WorkflowDesign graph with live execution state
   * so the UI can render colored node overlays.
   */
  getExecutionGraph(design: WorkflowDesign, execution: WorkflowExecution): ExecutionGraphNode[] {
    // Build adjacency from edges
    const children = new Map<string, string[]>()
    for (const edge of design.edges) {
      if (!children.has(edge.sourceNodeId)) children.set(edge.sourceNodeId, [])
      children.get(edge.sourceNodeId)!.push(edge.targetNodeId)
    }

    return design.nodes.map((node) => {
      const state = execution.nodeStates.get(node.id)
      const status = state?.status ?? "pending"
      const durationMs = state?.startedAt && state?.completedAt ? state.completedAt - state.startedAt : null

      return {
        nodeId: node.id,
        label: node.label,
        type: node.type,
        status,
        statusColor: ExecutionVisualizer.STATUS_COLORS[status],
        durationMs,
        error: state?.error,
        children: children.get(node.id) ?? [],
      }
    })
  }

  /**
   * Returns timing and retry metrics for a single node in the execution.
   */
  getNodeMetrics(
    execution: WorkflowExecution,
    nodeId: string,
  ): { durationMs: number | null; retryCount: number; status: NodeExecutionState["status"] } | null {
    const state = execution.nodeStates.get(nodeId)
    if (!state) return null

    return {
      durationMs: state.startedAt && state.completedAt ? state.completedAt - state.startedAt : null,
      retryCount: state.retryCount,
      status: state.status,
    }
  }

  /**
   * Returns a step-by-step audit trail of the execution.
   *
   * Useful for compliance logging and post-mortem debugging.
   * Entries are ordered chronologically by start time.
   */
  getAuditLog(execution: WorkflowExecution): AuditLogEntry[] {
    const entries: AuditLogEntry[] = []

    for (const [, state] of execution.nodeStates) {
      if (state.status === "pending") continue

      const durationMs = state.startedAt && state.completedAt ? state.completedAt - state.startedAt : null

      const event = this.statusToEvent(state.status, state.retryCount)

      entries.push({
        timestamp: state.startedAt ?? execution.startedAt,
        nodeId: state.nodeId,
        nodeLabel: state.nodeId,
        event,
        durationMs,
        input: state.input,
        output: state.output,
        error: state.error,
      })
    }

    entries.sort((a, b) => a.timestamp - b.timestamp)

    return entries
  }

  private statusToEvent(status: NodeExecutionState["status"], retryCount: number): AuditLogEntry["event"] {
    if (retryCount > 0 && status === "running") return "retried"
    switch (status) {
      case "running":
        return "started"
      case "completed":
        return "completed"
      case "failed":
        return "failed"
      case "skipped":
        return "skipped"
      default:
        return "started"
    }
  }
}
