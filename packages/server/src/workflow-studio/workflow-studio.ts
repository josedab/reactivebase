// --------------------------------------------------------------------------
// Visual Workflow Studio
// Drag-and-drop workflow designer with real-time monitoring and debugging
// --------------------------------------------------------------------------

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowNode {
  id: string
  type: WorkflowNodeType
  label: string
  position: { x: number; y: number }
  config: Record<string, unknown>
  inputs: PortDefinition[]
  outputs: PortDefinition[]
  metadata?: Record<string, unknown>
}

export type WorkflowNodeType =
  | "trigger"
  | "action"
  | "condition"
  | "delay"
  | "parallel"
  | "loop"
  | "transform"
  | "http"
  | "database"
  | "notification"
  | "custom"

export interface PortDefinition {
  id: string
  name: string
  type: "default" | "success" | "failure" | "conditional"
}

export interface WorkflowEdge {
  id: string
  sourceNodeId: string
  sourcePortId: string
  targetNodeId: string
  targetPortId: string
  condition?: string
  label?: string
}

export interface WorkflowDesign {
  id: string
  name: string
  description: string
  version: number
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables: WorkflowVariable[]
  createdAt: number
  updatedAt: number
}

export interface WorkflowVariable {
  name: string
  type: "string" | "number" | "boolean" | "object" | "array"
  defaultValue?: unknown
  description?: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  design: Omit<WorkflowDesign, "id" | "createdAt" | "updatedAt">
}

export interface WorkflowExecution {
  id: string
  workflowId: string
  status: "running" | "completed" | "failed" | "paused" | "cancelled"
  startedAt: number
  completedAt?: number
  currentNodeId?: string
  nodeStates: Map<string, NodeExecutionState>
  variables: Record<string, unknown>
  error?: string
}

export interface NodeExecutionState {
  nodeId: string
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  startedAt?: number
  completedAt?: number
  input?: unknown
  output?: unknown
  error?: string
  retryCount: number
}

export interface DebugBreakpoint {
  nodeId: string
  condition?: string
  enabled: boolean
}

export interface DebugSnapshot {
  executionId: string
  nodeId: string
  timestamp: number
  variables: Record<string, unknown>
  nodeInput: unknown
  nodeOutput: unknown
}

export interface WorkflowStudioOptions {
  maxNodes?: number
  maxExecutionHistory?: number
  enableDebugger?: boolean
}

export interface ValidationError {
  nodeId?: string
  edgeId?: string
  severity: "error" | "warning"
  message: string
  code: string
}

export interface MonitoringSnapshot {
  executionId: string
  workflowId: string
  status: WorkflowExecution["status"]
  progress: number
  activeNodes: string[]
  completedNodes: string[]
  failedNodes: string[]
  duration: number
}

// ── Error ──────────────────────────────────────────────────────────────────

export class WorkflowStudioError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = "WorkflowStudioError"
  }
}

// ── SQL Builders ───────────────────────────────────────────────────────────

export function buildCreateWorkflowStudioTablesSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS _rb_wf_designs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      nodes JSONB NOT NULL DEFAULT '[]',
      edges JSONB NOT NULL DEFAULT '[]',
      variables JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS _rb_wf_executions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES _rb_wf_designs(id),
      status TEXT NOT NULL DEFAULT 'running',
      node_states JSONB NOT NULL DEFAULT '{}',
      variables JSONB NOT NULL DEFAULT '{}',
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_wf_exec_workflow ON _rb_wf_executions (workflow_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_wf_exec_status ON _rb_wf_executions (status);

    CREATE TABLE IF NOT EXISTS _rb_wf_debug_snapshots (
      id BIGSERIAL PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES _rb_wf_executions(id),
      node_id TEXT NOT NULL,
      variables JSONB NOT NULL DEFAULT '{}',
      node_input JSONB,
      node_output JSONB,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wf_debug_exec ON _rb_wf_debug_snapshots (execution_id, timestamp);

    CREATE TABLE IF NOT EXISTS _rb_wf_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      tags TEXT[] NOT NULL DEFAULT '{}',
      design JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `
}

export function buildUpsertDesignSQL(): string {
  return `
    INSERT INTO _rb_wf_designs (id, name, description, version, nodes, edges, variables, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (id) DO UPDATE SET name = $2, description = $3, version = $4,
      nodes = $5, edges = $6, variables = $7, updated_at = NOW()
  `
}

export function buildGetDesignSQL(): string {
  return `SELECT * FROM _rb_wf_designs WHERE id = $1`
}

export function buildInsertExecutionSQL(): string {
  return `
    INSERT INTO _rb_wf_executions (id, workflow_id, status, variables)
    VALUES ($1, $2, $3, $4)
  `
}

export function buildUpdateExecutionSQL(): string {
  return `
    UPDATE _rb_wf_executions
    SET status = $2, node_states = $3, variables = $4, error = $5, completed_at = $6
    WHERE id = $1
  `
}

export function buildInsertDebugSnapshotSQL(): string {
  return `
    INSERT INTO _rb_wf_debug_snapshots (execution_id, node_id, variables, node_input, node_output)
    VALUES ($1, $2, $3, $4, $5)
  `
}

// ── Built-in Templates ─────────────────────────────────────────────────────

export const builtInTemplates: WorkflowTemplate[] = [
  {
    id: "approval-flow",
    name: "Approval Flow",
    description: "Multi-step approval process with escalation",
    category: "business",
    tags: ["approval", "escalation"],
    design: {
      name: "Approval Flow",
      description: "Multi-step approval with timeout escalation",
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          label: "Request Submitted",
          position: { x: 100, y: 200 },
          config: { event: "approval.requested" },
          inputs: [],
          outputs: [{ id: "out-1", name: "next", type: "default" }],
        },
        {
          id: "action-1",
          type: "action",
          label: "Notify Approver",
          position: { x: 350, y: 200 },
          config: { action: "send_notification" },
          inputs: [{ id: "in-1", name: "input", type: "default" }],
          outputs: [
            { id: "out-1", name: "approved", type: "success" },
            { id: "out-2", name: "rejected", type: "failure" },
          ],
        },
        {
          id: "condition-1",
          type: "condition",
          label: "Check Amount",
          position: { x: 600, y: 200 },
          config: { expression: "amount > 10000" },
          inputs: [{ id: "in-1", name: "input", type: "default" }],
          outputs: [
            { id: "out-1", name: "true", type: "conditional" },
            { id: "out-2", name: "false", type: "conditional" },
          ],
        },
      ],
      edges: [
        { id: "e-1", sourceNodeId: "trigger-1", sourcePortId: "out-1", targetNodeId: "action-1", targetPortId: "in-1" },
        {
          id: "e-2",
          sourceNodeId: "action-1",
          sourcePortId: "out-1",
          targetNodeId: "condition-1",
          targetPortId: "in-1",
        },
      ],
      variables: [
        { name: "amount", type: "number", description: "Approval amount" },
        { name: "approver", type: "string", description: "Current approver" },
      ],
    },
  },
  {
    id: "data-pipeline",
    name: "Data Pipeline",
    description: "ETL pipeline with parallel processing",
    category: "data",
    tags: ["etl", "pipeline", "parallel"],
    design: {
      name: "Data Pipeline",
      description: "Extract, transform, load with parallel stages",
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          label: "Schedule",
          position: { x: 100, y: 200 },
          config: { cron: "0 * * * *" },
          inputs: [],
          outputs: [{ id: "out-1", name: "next", type: "default" }],
        },
        {
          id: "database-1",
          type: "database",
          label: "Extract Data",
          position: { x: 350, y: 200 },
          config: { query: "SELECT * FROM source" },
          inputs: [{ id: "in-1", name: "input", type: "default" }],
          outputs: [{ id: "out-1", name: "rows", type: "default" }],
        },
        {
          id: "transform-1",
          type: "transform",
          label: "Transform",
          position: { x: 600, y: 200 },
          config: { mapping: {} },
          inputs: [{ id: "in-1", name: "input", type: "default" }],
          outputs: [{ id: "out-1", name: "output", type: "default" }],
        },
      ],
      edges: [
        {
          id: "e-1",
          sourceNodeId: "trigger-1",
          sourcePortId: "out-1",
          targetNodeId: "database-1",
          targetPortId: "in-1",
        },
        {
          id: "e-2",
          sourceNodeId: "database-1",
          sourcePortId: "out-1",
          targetNodeId: "transform-1",
          targetPortId: "in-1",
        },
      ],
      variables: [],
    },
  },
  {
    id: "webhook-handler",
    name: "Webhook Handler",
    description: "Process incoming webhooks with validation and routing",
    category: "integration",
    tags: ["webhook", "api", "routing"],
    design: {
      name: "Webhook Handler",
      description: "Validate and route incoming webhooks",
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          label: "Webhook Received",
          position: { x: 100, y: 200 },
          config: { path: "/webhooks/incoming" },
          inputs: [],
          outputs: [{ id: "out-1", name: "payload", type: "default" }],
        },
        {
          id: "condition-1",
          type: "condition",
          label: "Validate Signature",
          position: { x: 350, y: 200 },
          config: { expression: "isValidSignature(headers)" },
          inputs: [{ id: "in-1", name: "input", type: "default" }],
          outputs: [
            { id: "out-1", name: "valid", type: "success" },
            { id: "out-2", name: "invalid", type: "failure" },
          ],
        },
      ],
      edges: [
        {
          id: "e-1",
          sourceNodeId: "trigger-1",
          sourcePortId: "out-1",
          targetNodeId: "condition-1",
          targetPortId: "in-1",
        },
      ],
      variables: [{ name: "secret", type: "string", description: "Webhook signing secret" }],
    },
  },
]

// ── Workflow Validator ──────────────────────────────────────────────────────

export class WorkflowValidator {
  validate(design: WorkflowDesign): ValidationError[] {
    const errors: ValidationError[] = []

    if (design.nodes.length === 0) {
      errors.push({ severity: "error", message: "Workflow has no nodes", code: "EMPTY_WORKFLOW" })
      return errors
    }

    // Check for trigger node
    const triggers = design.nodes.filter((n) => n.type === "trigger")
    if (triggers.length === 0) {
      errors.push({ severity: "error", message: "Workflow has no trigger node", code: "NO_TRIGGER" })
    }

    // Check for orphan nodes
    const connectedNodes = new Set<string>()
    for (const edge of design.edges) {
      connectedNodes.add(edge.sourceNodeId)
      connectedNodes.add(edge.targetNodeId)
    }
    for (const node of design.nodes) {
      if (!connectedNodes.has(node.id) && design.nodes.length > 1) {
        errors.push({
          nodeId: node.id,
          severity: "warning",
          message: `Node "${node.label}" is disconnected`,
          code: "ORPHAN_NODE",
        })
      }
    }

    // Check for invalid edge references
    const nodeIds = new Set(design.nodes.map((n) => n.id))
    for (const edge of design.edges) {
      if (!nodeIds.has(edge.sourceNodeId)) {
        errors.push({
          edgeId: edge.id,
          severity: "error",
          message: `Edge references missing source node: ${edge.sourceNodeId}`,
          code: "INVALID_EDGE_SOURCE",
        })
      }
      if (!nodeIds.has(edge.targetNodeId)) {
        errors.push({
          edgeId: edge.id,
          severity: "error",
          message: `Edge references missing target node: ${edge.targetNodeId}`,
          code: "INVALID_EDGE_TARGET",
        })
      }
    }

    // Detect cycles
    if (this.hasCycle(design)) {
      errors.push({
        severity: "warning",
        message: "Workflow contains a cycle (may cause infinite loops unless intentional)",
        code: "CYCLE_DETECTED",
      })
    }

    return errors
  }

  private hasCycle(design: WorkflowDesign): boolean {
    const adjacency = new Map<string, string[]>()
    for (const edge of design.edges) {
      if (!adjacency.has(edge.sourceNodeId)) adjacency.set(edge.sourceNodeId, [])
      adjacency.get(edge.sourceNodeId)!.push(edge.targetNodeId)
    }

    const visited = new Set<string>()
    const inStack = new Set<string>()

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId)
      inStack.add(nodeId)
      for (const neighbor of adjacency.get(nodeId) || []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true
        } else if (inStack.has(neighbor)) {
          return true
        }
      }
      inStack.delete(nodeId)
      return false
    }

    for (const node of design.nodes) {
      if (!visited.has(node.id) && dfs(node.id)) return true
    }
    return false
  }
}

// ── Workflow Debugger ──────────────────────────────────────────────────────

export class WorkflowDebugger {
  private breakpoints = new Map<string, DebugBreakpoint>()
  private snapshots: DebugSnapshot[] = []
  private maxSnapshots: number

  constructor(maxSnapshots: number = 1000) {
    this.maxSnapshots = maxSnapshots
  }

  setBreakpoint(bp: DebugBreakpoint): void {
    this.breakpoints.set(bp.nodeId, bp)
  }

  removeBreakpoint(nodeId: string): void {
    this.breakpoints.delete(nodeId)
  }

  shouldBreak(nodeId: string, variables: Record<string, unknown>): boolean {
    const bp = this.breakpoints.get(nodeId)
    if (!bp || !bp.enabled) return false
    if (!bp.condition) return true

    try {
      // Simple expression evaluation for conditions like "count > 5"
      const fn = new Function(...Object.keys(variables), `return ${bp.condition}`)
      return !!fn(...Object.values(variables))
    } catch {
      return true // Break on invalid condition for safety
    }
  }

  captureSnapshot(snapshot: DebugSnapshot): void {
    if (this.snapshots.length >= this.maxSnapshots) {
      this.snapshots.shift()
    }
    this.snapshots.push(snapshot)
  }

  getSnapshots(executionId: string): DebugSnapshot[] {
    return this.snapshots.filter((s) => s.executionId === executionId)
  }

  getNodeSnapshots(executionId: string, nodeId: string): DebugSnapshot[] {
    return this.snapshots.filter((s) => s.executionId === executionId && s.nodeId === nodeId)
  }

  clearSnapshots(): void {
    this.snapshots = []
  }

  getBreakpoints(): DebugBreakpoint[] {
    return Array.from(this.breakpoints.values())
  }
}

// ── Workflow Studio (Main Engine) ──────────────────────────────────────────

export class WorkflowStudio {
  private designs = new Map<string, WorkflowDesign>()
  private executions = new Map<string, WorkflowExecution>()
  private templates = new Map<string, WorkflowTemplate>()
  readonly validator = new WorkflowValidator()
  readonly debugger: WorkflowDebugger
  private readonly maxNodes: number
  private readonly maxHistory: number
  private listeners = new Map<string, Set<(snapshot: MonitoringSnapshot) => void>>()

  constructor(options: WorkflowStudioOptions = {}) {
    this.maxNodes = options.maxNodes ?? 100
    this.maxHistory = options.maxExecutionHistory ?? 1000
    this.debugger = new WorkflowDebugger()

    // Register built-in templates
    for (const tpl of builtInTemplates) {
      this.templates.set(tpl.id, tpl)
    }
  }

  saveDesign(design: WorkflowDesign): ValidationError[] {
    if (design.nodes.length > this.maxNodes) {
      throw new WorkflowStudioError(`Too many nodes (${design.nodes.length} > ${this.maxNodes})`, "MAX_NODES_EXCEEDED")
    }

    const errors = this.validator.validate(design)
    const criticalErrors = errors.filter((e) => e.severity === "error")
    if (criticalErrors.length > 0) return errors

    design.updatedAt = Date.now()
    this.designs.set(design.id, design)
    return errors
  }

  getDesign(id: string): WorkflowDesign | null {
    return this.designs.get(id) || null
  }

  deleteDesign(id: string): boolean {
    return this.designs.delete(id)
  }

  listDesigns(): WorkflowDesign[] {
    return Array.from(this.designs.values())
  }

  startExecution(workflowId: string, variables: Record<string, unknown> = {}): WorkflowExecution {
    const design = this.designs.get(workflowId)
    if (!design) {
      throw new WorkflowStudioError(`Workflow ${workflowId} not found`, "WORKFLOW_NOT_FOUND")
    }

    const execution: WorkflowExecution = {
      id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      workflowId,
      status: "running",
      startedAt: Date.now(),
      nodeStates: new Map(),
      variables: { ...variables },
    }

    // Initialize node states
    for (const node of design.nodes) {
      execution.nodeStates.set(node.id, {
        nodeId: node.id,
        status: "pending",
        retryCount: 0,
      })
    }

    this.executions.set(execution.id, execution)
    return execution
  }

  advanceExecution(executionId: string, nodeId: string, output: unknown): void {
    const execution = this.executions.get(executionId)
    if (!execution) {
      throw new WorkflowStudioError(`Execution ${executionId} not found`, "EXECUTION_NOT_FOUND")
    }

    const nodeState = execution.nodeStates.get(nodeId)
    if (!nodeState) {
      throw new WorkflowStudioError(`Node ${nodeId} not in execution`, "NODE_NOT_FOUND")
    }

    nodeState.status = "completed"
    nodeState.completedAt = Date.now()
    nodeState.output = output

    // Capture debug snapshot
    this.debugger.captureSnapshot({
      executionId,
      nodeId,
      timestamp: Date.now(),
      variables: { ...execution.variables },
      nodeInput: nodeState.input,
      nodeOutput: output,
    })

    // Find next nodes
    const design = this.designs.get(execution.workflowId)!
    const outEdges = design.edges.filter((e) => e.sourceNodeId === nodeId)

    for (const edge of outEdges) {
      const nextState = execution.nodeStates.get(edge.targetNodeId)
      if (nextState && nextState.status === "pending") {
        nextState.status = "running"
        nextState.startedAt = Date.now()
        nextState.input = output
        execution.currentNodeId = edge.targetNodeId
      }
    }

    // Check completion
    const allDone = Array.from(execution.nodeStates.values()).every(
      (s) => s.status === "completed" || s.status === "skipped" || s.status === "failed",
    )
    if (allDone) {
      execution.status = "completed"
      execution.completedAt = Date.now()
    }

    this.notifyMonitors(execution)
  }

  failNode(executionId: string, nodeId: string, error: string): void {
    const execution = this.executions.get(executionId)
    if (!execution) return

    const nodeState = execution.nodeStates.get(nodeId)
    if (!nodeState) return

    nodeState.status = "failed"
    nodeState.completedAt = Date.now()
    nodeState.error = error

    execution.status = "failed"
    execution.error = `Node ${nodeId}: ${error}`
    execution.completedAt = Date.now()

    this.notifyMonitors(execution)
  }

  getExecution(id: string): WorkflowExecution | null {
    return this.executions.get(id) || null
  }

  getMonitoringSnapshot(executionId: string): MonitoringSnapshot | null {
    const execution = this.executions.get(executionId)
    if (!execution) return null

    const design = this.designs.get(execution.workflowId)
    const totalNodes = design?.nodes.length || 0
    const states = Array.from(execution.nodeStates.values())

    return {
      executionId,
      workflowId: execution.workflowId,
      status: execution.status,
      progress: totalNodes > 0 ? states.filter((s) => s.status === "completed").length / totalNodes : 0,
      activeNodes: states.filter((s) => s.status === "running").map((s) => s.nodeId),
      completedNodes: states.filter((s) => s.status === "completed").map((s) => s.nodeId),
      failedNodes: states.filter((s) => s.status === "failed").map((s) => s.nodeId),
      duration: (execution.completedAt || Date.now()) - execution.startedAt,
    }
  }

  onMonitor(workflowId: string, callback: (snapshot: MonitoringSnapshot) => void): () => void {
    if (!this.listeners.has(workflowId)) this.listeners.set(workflowId, new Set())
    this.listeners.get(workflowId)!.add(callback)
    return () => this.listeners.get(workflowId)?.delete(callback)
  }

  getTemplates(category?: string): WorkflowTemplate[] {
    const all = Array.from(this.templates.values())
    return category ? all.filter((t) => t.category === category) : all
  }

  createFromTemplate(templateId: string, name: string): WorkflowDesign {
    const template = this.templates.get(templateId)
    if (!template) {
      throw new WorkflowStudioError(`Template ${templateId} not found`, "TEMPLATE_NOT_FOUND")
    }

    const design: WorkflowDesign = {
      ...template.design,
      id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.designs.set(design.id, design)
    return design
  }

  registerTemplate(template: WorkflowTemplate): void {
    this.templates.set(template.id, template)
  }

  private notifyMonitors(execution: WorkflowExecution): void {
    const snapshot = this.getMonitoringSnapshot(execution.id)
    if (!snapshot) return

    const listeners = this.listeners.get(execution.workflowId)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(snapshot)
        } catch {
          // Swallow listener errors
        }
      }
    }
  }
}
