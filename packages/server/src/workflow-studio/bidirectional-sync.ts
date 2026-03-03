/**
 * Bidirectional Code-Visual Sync for Workflow Studio.
 *
 * Features:
 *   - Parse defineWorkflow() TypeScript code into a visual WorkflowDesign
 *   - Compile visual WorkflowDesign back to TypeScript code
 *   - Live execution DAG visualization with breakpoint support
 *   - Diff detection for incremental sync
 *
 * Usage:
 *   const sync = new BidirectionalWorkflowSync()
 *   const design = sync.codeToVisual(typescriptCode)
 *   const code = sync.visualToCode(design)
 *   const dag = sync.buildExecutionDAG(execution)
 */

import type {
  WorkflowDesign,
  WorkflowNode,
  WorkflowEdge,
  WorkflowVariable,
  WorkflowExecution,
  NodeExecutionState,
  WorkflowNodeType,
} from "./workflow-studio.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedWorkflow {
  design: WorkflowDesign
  parseErrors: ParseError[]
  sourceMap: Map<string, SourceLocation>
}

export interface ParseError {
  line: number
  column: number
  message: string
  severity: "error" | "warning"
}

export interface SourceLocation {
  nodeId: string
  startLine: number
  endLine: number
}

export interface ExecutionDAGNode {
  nodeId: string
  label: string
  type: WorkflowNodeType
  status: NodeExecutionState["status"]
  duration?: number
  error?: string
  input: unknown
  output: unknown
  children: string[]
  parents: string[]
  /** Whether a breakpoint is set on this node */
  hasBreakpoint: boolean
  /** Whether execution is paused at this node */
  isPaused: boolean
}

export interface ExecutionDAG {
  nodes: ExecutionDAGNode[]
  edges: Array<{ from: string; to: string; label?: string }>
  activeNodeId?: string
  completedCount: number
  totalCount: number
  status: "running" | "completed" | "failed" | "paused"
}

export interface WorkflowDiff {
  addedNodes: string[]
  removedNodes: string[]
  modifiedNodes: string[]
  addedEdges: string[]
  removedEdges: string[]
}

export interface HumanApprovalConfig {
  /** Who can approve (user IDs or role names) */
  approvers: string[]
  /** Timeout before auto-escalation in ms */
  timeoutMs: number
  /** Escalation target if timeout is reached */
  escalateTo?: string[]
  /** Message to show the approver */
  message: string
  /** Required number of approvals (default: 1) */
  requiredApprovals?: number
}

// ─── Bidirectional Sync ──────────────────────────────────────────────────────

/**
 * Bidirectional sync between visual workflow designs and TypeScript code.
 */
export class BidirectionalWorkflowSync {
  /**
   * Parse TypeScript workflow code into a visual WorkflowDesign.
   * Extracts node definitions, edges, and variables from code structure.
   */
  codeToVisual(code: string): ParsedWorkflow {
    const errors: ParseError[] = []
    const sourceMap = new Map<string, SourceLocation>()
    const nodes: WorkflowNode[] = []
    const edges: WorkflowEdge[] = []
    const variables: WorkflowVariable[] = []

    const _lines = code.split("\n")
    let nodeCounter = 0

    // Extract workflow name
    const nameMatch = /defineWorkflow\s*\(\s*["']([^"']+)["']/.exec(code)
    const workflowName = nameMatch?.[1] ?? "untitled"

    // Parse step definitions
    const stepRegex = /\.step\s*\(\s*["']([^"']+)["']\s*,\s*\{([^}]+)\}/g
    let match: RegExpExecArray | null

    while ((match = stepRegex.exec(code)) !== null) {
      const stepName = match[1]
      const configBlock = match[2]
      nodeCounter++

      const typeMatch = /type:\s*["'](\w+)["']/.exec(configBlock)
      const nodeType = (typeMatch?.[1] as WorkflowNodeType) ?? "action"

      const node: WorkflowNode = {
        id: `node_${nodeCounter}`,
        type: nodeType,
        label: stepName,
        position: { x: 100, y: nodeCounter * 120 },
        config: this.parseConfigBlock(configBlock),
        inputs: [{ id: `${stepName}_in`, name: "input", type: "default" }],
        outputs: [{ id: `${stepName}_out`, name: "output", type: "default" }],
      }

      nodes.push(node)

      const lineIdx = code.substring(0, match.index).split("\n").length
      sourceMap.set(node.id, { nodeId: node.id, startLine: lineIdx, endLine: lineIdx + 3 })
    }

    // Auto-generate edges between sequential steps
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        id: `edge_${i}`,
        sourceNodeId: nodes[i].id,
        targetNodeId: nodes[i + 1].id,
        sourcePortId: `${nodes[i].label}_out`,
        targetPortId: `${nodes[i + 1].label}_in`,
      })
    }

    // Parse variables
    const varRegex = /variables:\s*\{([^}]+)\}/
    const varMatch = varRegex.exec(code)
    if (varMatch) {
      const varBlock = varMatch[1]
      const varPairs = varBlock.matchAll(/(\w+):\s*["']([^"']+)["']/g)
      for (const vp of varPairs) {
        variables.push({ name: vp[1], type: "string", defaultValue: vp[2] })
      }
    }

    if (nodes.length === 0 && code.trim().length > 0) {
      errors.push({ line: 1, column: 0, message: "No workflow steps found in code", severity: "warning" })
    }

    const design: WorkflowDesign = {
      id: `wf_${Date.now().toString(36)}`,
      name: workflowName,
      description: "",
      nodes,
      edges,
      variables,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    return { design, parseErrors: errors, sourceMap }
  }

  /**
   * Compile a visual WorkflowDesign to TypeScript code.
   */
  visualToCode(design: WorkflowDesign): string {
    const lines: string[] = []
    lines.push(`import { defineWorkflow } from "reactivebase"`)
    lines.push("")
    lines.push(`export const ${this.camelCase(design.name)} = defineWorkflow("${design.name}", {`)

    // Variables
    if (design.variables.length > 0) {
      lines.push("  variables: {")
      for (const v of design.variables) {
        const def = v.defaultValue !== undefined ? JSON.stringify(v.defaultValue) : "undefined"
        lines.push(`    ${v.name}: ${def},`)
      }
      lines.push("  },")
    }

    lines.push("")

    // Steps — topologically sorted by edges
    const sorted = this.topologicalSort(design.nodes, design.edges)
    for (const node of sorted) {
      lines.push(this.nodeToCode(node))
    }

    lines.push("})")
    return lines.join("\n")
  }

  /**
   * Build a live execution DAG for visualization.
   */
  buildExecutionDAG(
    design: WorkflowDesign,
    execution: WorkflowExecution,
    breakpoints: Set<string> = new Set(),
  ): ExecutionDAG {
    const dagNodes: ExecutionDAGNode[] = design.nodes.map((node) => {
      const state = execution.nodeStates.get(node.id)
      const children = design.edges.filter((e) => e.sourceNodeId === node.id).map((e) => e.targetNodeId)
      const parents = design.edges.filter((e) => e.targetNodeId === node.id).map((e) => e.sourceNodeId)

      return {
        nodeId: node.id,
        label: node.label,
        type: node.type,
        status: state?.status ?? "pending",
        duration: state?.completedAt && state?.startedAt ? state.completedAt - state.startedAt : undefined,
        error: state?.error,
        input: state?.input ?? {},
        output: state?.output ?? {},
        children,
        parents,
        hasBreakpoint: breakpoints.has(node.id),
        isPaused: breakpoints.has(node.id) && state?.status === "running",
      }
    })

    const dagEdges = design.edges.map((e) => ({
      from: e.sourceNodeId,
      to: e.targetNodeId,
      label: e.condition,
    }))

    const completedCount = dagNodes.filter((n) => n.status === "completed").length
    const activeNode = dagNodes.find((n) => n.status === "running")
    const failedNode = dagNodes.find((n) => n.status === "failed")
    const pausedNode = dagNodes.find((n) => n.isPaused)

    let status: ExecutionDAG["status"] = "running"
    if (pausedNode) status = "paused"
    else if (failedNode) status = "failed"
    else if (completedCount === dagNodes.length) status = "completed"

    return {
      nodes: dagNodes,
      edges: dagEdges,
      activeNodeId: activeNode?.nodeId,
      completedCount,
      totalCount: dagNodes.length,
      status,
    }
  }

  /**
   * Compute a diff between two workflow designs.
   */
  diff(before: WorkflowDesign, after: WorkflowDesign): WorkflowDiff {
    const beforeNodeIds = new Set(before.nodes.map((n) => n.id))
    const afterNodeIds = new Set(after.nodes.map((n) => n.id))
    const beforeEdgeIds = new Set(before.edges.map((e) => e.id))
    const afterEdgeIds = new Set(after.edges.map((e) => e.id))

    const addedNodes = after.nodes.filter((n) => !beforeNodeIds.has(n.id)).map((n) => n.id)
    const removedNodes = before.nodes.filter((n) => !afterNodeIds.has(n.id)).map((n) => n.id)
    const modifiedNodes = after.nodes
      .filter((n) => {
        if (!beforeNodeIds.has(n.id)) return false
        const prev = before.nodes.find((bn) => bn.id === n.id)
        return prev && JSON.stringify(prev.config) !== JSON.stringify(n.config)
      })
      .map((n) => n.id)

    const addedEdges = after.edges.filter((e) => !beforeEdgeIds.has(e.id)).map((e) => e.id)
    const removedEdges = before.edges.filter((e) => !afterEdgeIds.has(e.id)).map((e) => e.id)

    return { addedNodes, removedNodes, modifiedNodes, addedEdges, removedEdges }
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private parseConfigBlock(block: string): Record<string, unknown> {
    const config: Record<string, unknown> = {}
    const pairs = block.matchAll(/(\w+):\s*(?:"([^"]+)"|'([^']+)'|(\d+)|(\w+))/g)
    for (const pair of pairs) {
      const key = pair[1]
      const value = pair[2] ?? pair[3] ?? (pair[4] ? Number(pair[4]) : pair[5])
      config[key] = value
    }
    return config
  }

  private nodeToCode(node: WorkflowNode): string {
    const config = node.config ? JSON.stringify(node.config, null, 4).replace(/\n/g, "\n    ") : "{}"

    switch (node.type) {
      case "trigger":
        return `  .trigger("${node.label}", ${config})\n`
      case "condition":
        return `  .condition("${node.label}", (ctx) => {\n    return ${config}\n  })\n`
      case "delay":
        return `  .delay("${node.label}", ${node.config?.duration ?? '"1m"'})\n`
      case "parallel":
        return `  .parallel("${node.label}", ${config})\n`
      case "human-approval":
        return `  .step("${node.label}", {\n    type: "human-approval",\n    config: ${config},\n  })\n`
      case "query":
        return `  .step("${node.label}", {\n    type: "query",\n    handler: async (ctx) => ctx.db.${node.config?.table ?? "table"}.where({}),\n  })\n`
      case "mutation":
        return `  .step("${node.label}", {\n    type: "mutation",\n    handler: async (ctx, input) => ctx.db.${node.config?.table ?? "table"}.insert(input),\n  })\n`
      default:
        return `  .step("${node.label}", {\n    type: "${node.type}",\n    handler: async (ctx) => {\n      // ${node.label} logic\n    },\n  })\n`
    }
  }

  private topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))

    for (const node of nodes) {
      inDegree.set(node.id, 0)
      adjacency.set(node.id, [])
    }

    for (const edge of edges) {
      adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId)
      inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1)
    }

    const queue: string[] = []
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id)
    }

    const sorted: WorkflowNode[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      const node = nodeMap.get(id)
      if (node) sorted.push(node)

      for (const child of adjacency.get(id) ?? []) {
        const newDegree = (inDegree.get(child) ?? 1) - 1
        inDegree.set(child, newDegree)
        if (newDegree === 0) queue.push(child)
      }
    }

    // Append any nodes not reached (disconnected)
    for (const node of nodes) {
      if (!sorted.find((n) => n.id === node.id)) sorted.push(node)
    }

    return sorted
  }

  private camelCase(str: string): string {
    return str.replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/^[A-Z]/, (c) => c.toLowerCase())
  }
}
