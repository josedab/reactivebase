/**
 * Collaborative CRDT Engine for ReactiveBase.
 * Provides conflict-free replicated data types for real-time collaborative editing.
 *
 * Supported CRDT types:
 *   - LWW-Register: Last-writer-wins register for atomic values
 *   - G-Counter: Grow-only counter (increment by any node)
 *   - PN-Counter: Positive-negative counter (increment/decrement)
 *   - OR-Set: Observed-remove set (add/remove elements without conflicts)
 *   - RGA: Replicated Growable Array for collaborative text editing
 *
 * Usage:
 *   const doc = engine.createDocument("doc-1", "lww-register")
 *   doc.set("title", "Hello")
 *   engine.applyRemoteOperation(op)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CrdtOperation {
  docId: string
  type: CrdtType
  operationId: string
  nodeId: string
  timestamp: number
  /** Lamport clock for causal ordering */
  clock: number
  data: LwwRegisterOp | GCounterOp | PnCounterOp | OrSetOp | RgaOp
}

export type CrdtType = "lww-register" | "g-counter" | "pn-counter" | "or-set" | "rga"

export interface LwwRegisterOp {
  kind: "lww-set"
  key: string
  value: unknown
}

export interface GCounterOp {
  kind: "g-increment"
  amount: number
}

export interface PnCounterOp {
  kind: "pn-increment" | "pn-decrement"
  amount: number
}

export interface OrSetOp {
  kind: "or-add" | "or-remove"
  element: unknown
  /** Unique tag for add operations, used by remove to identify which add to cancel */
  tag: string
}

export interface RgaOp {
  kind: "rga-insert" | "rga-delete"
  /** Position ID: `${clock}:${nodeId}` */
  positionId: string
  /** Insert after this position ID (null = head) */
  afterId: string | null
  /** Character/element to insert */
  value?: string
}

export interface CrdtDocument<T = unknown> {
  id: string
  type: CrdtType
  state: T
  clock: number
  nodeId: string
}

export interface CrdtEngineOptions {
  /** Unique node identifier for this server instance */
  nodeId?: string
  /** Max operations to buffer before compaction (default: 1000) */
  compactionThreshold?: number
  /** Callback when operations are generated locally */
  onOperation?: (op: CrdtOperation) => void
  /** Callback when document state changes */
  onStateChange?: (docId: string, state: unknown) => void
}

export interface CrdtSnapshot {
  docId: string
  type: CrdtType
  state: unknown
  clock: number
  operationCount: number
  createdAt: number
  updatedAt: number
}

// ─── CRDT State Types ────────────────────────────────────────────────────────

interface LwwRegisterState {
  values: Map<string, { value: unknown; timestamp: number; nodeId: string }>
}

interface GCounterState {
  counts: Map<string, number>
}

interface PnCounterState {
  positive: Map<string, number>
  negative: Map<string, number>
}

interface OrSetState {
  elements: Map<string, Set<string>>
  tombstones: Set<string>
}

interface RgaNode {
  id: string
  value: string | null
  deleted: boolean
  afterId: string | null
}

interface RgaState {
  nodes: Map<string, RgaNode>
  order: string[]
}

// ─── Persistence SQL ─────────────────────────────────────────────────────────

export function generateCrdtTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_crdt_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  state JSONB NOT NULL DEFAULT '{}',
  clock BIGINT NOT NULL DEFAULT 0,
  node_id TEXT NOT NULL,
  operation_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _reactivebase_crdt_operations (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES _reactivebase_crdt_documents(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  clock BIGINT NOT NULL,
  timestamp BIGINT NOT NULL,
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crdt_ops_doc_clock
  ON _reactivebase_crdt_operations(doc_id, clock);

CREATE INDEX IF NOT EXISTS idx_crdt_ops_doc_timestamp
  ON _reactivebase_crdt_operations(doc_id, timestamp);
`.trim()
}

export function buildUpsertDocumentSQL(
  docId: string,
  type: CrdtType,
  state: unknown,
  clock: number,
  nodeId: string,
  opCount: number,
): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_crdt_documents (id, type, state, clock, node_id, operation_count)
VALUES ($1, $2, $3::jsonb, $4, $5, $6)
ON CONFLICT (id) DO UPDATE SET
  state = $3::jsonb,
  clock = GREATEST(_reactivebase_crdt_documents.clock, $4),
  operation_count = _reactivebase_crdt_documents.operation_count + $6,
  updated_at = NOW()
RETURNING *`,
    params: [docId, type, JSON.stringify(state), clock, nodeId, opCount],
  }
}

export function buildInsertOperationSQL(op: CrdtOperation): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_crdt_operations (id, doc_id, node_id, clock, timestamp, type, data)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
ON CONFLICT (id) DO NOTHING`,
    params: [
      op.operationId,
      op.docId,
      op.nodeId,
      op.clock,
      op.timestamp,
      op.type,
      JSON.stringify(op.data),
    ],
  }
}

export function buildGetDocumentSQL(docId: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT * FROM _reactivebase_crdt_documents WHERE id = $1`,
    params: [docId],
  }
}

export function buildGetOperationsSinceSQL(
  docId: string,
  sinceClock: number,
): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT * FROM _reactivebase_crdt_operations WHERE doc_id = $1 AND clock > $2 ORDER BY clock ASC`,
    params: [docId, sinceClock],
  }
}

export function buildCompactOperationsSQL(
  docId: string,
  beforeClock: number,
): { sql: string; params: unknown[] } {
  return {
    sql: `DELETE FROM _reactivebase_crdt_operations WHERE doc_id = $1 AND clock < $2`,
    params: [docId, beforeClock],
  }
}

// ─── CrdtEngine ──────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<CrdtEngineOptions> = {
  nodeId: `node-${Math.random().toString(36).substring(2, 10)}`,
  compactionThreshold: 1000,
  onOperation: () => {},
  onStateChange: () => {},
}

export class CrdtEngine {
  private options: Required<CrdtEngineOptions>
  private documents = new Map<string, CrdtDocument>()
  private operationLog = new Map<string, CrdtOperation[]>()
  private listeners = new Map<string, Set<(state: unknown) => void>>()

  constructor(options: CrdtEngineOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  get nodeId(): string {
    return this.options.nodeId
  }

  get documentCount(): number {
    return this.documents.size
  }

  /**
   * Create a new CRDT document.
   */
  createDocument(docId: string, type: CrdtType): CrdtDocumentHandle {
    if (this.documents.has(docId)) {
      throw new CrdtError(`Document "${docId}" already exists`)
    }

    const state = this.createInitialState(type)
    const doc: CrdtDocument = {
      id: docId,
      type,
      state,
      clock: 0,
      nodeId: this.options.nodeId,
    }

    this.documents.set(docId, doc)
    this.operationLog.set(docId, [])

    return new CrdtDocumentHandle(doc, this)
  }

  /**
   * Get an existing document or throw.
   */
  getDocument(docId: string): CrdtDocumentHandle {
    const doc = this.documents.get(docId)
    if (!doc) {
      throw new CrdtError(`Document "${docId}" not found`)
    }
    return new CrdtDocumentHandle(doc, this)
  }

  /**
   * Check if a document exists.
   */
  hasDocument(docId: string): boolean {
    return this.documents.has(docId)
  }

  /**
   * Load a document from a serialized snapshot.
   */
  loadDocument(snapshot: CrdtSnapshot): CrdtDocumentHandle {
    const doc: CrdtDocument = {
      id: snapshot.docId,
      type: snapshot.type,
      state: this.createInitialState(snapshot.type),
      clock: snapshot.clock,
      nodeId: this.options.nodeId,
    }

    this.documents.set(snapshot.docId, doc)
    this.operationLog.set(snapshot.docId, [])

    return new CrdtDocumentHandle(doc, this)
  }

  /**
   * Apply a remote operation from another node.
   */
  applyRemoteOperation(op: CrdtOperation): void {
    let doc = this.documents.get(op.docId)
    if (!doc) {
      const state = this.createInitialState(op.type)
      doc = { id: op.docId, type: op.type, state, clock: 0, nodeId: this.options.nodeId }
      this.documents.set(op.docId, doc)
      this.operationLog.set(op.docId, [])
    }

    this.applyOperation(doc, op)
    doc.clock = Math.max(doc.clock, op.clock)

    const ops = this.operationLog.get(op.docId)!
    ops.push(op)

    this.notifyListeners(op.docId, doc.state)
    this.options.onStateChange(op.docId, this.serializeState(doc))

    if (ops.length >= this.options.compactionThreshold) {
      this.compact(op.docId)
    }
  }

  /**
   * Subscribe to state changes on a document.
   */
  subscribe(docId: string, listener: (state: unknown) => void): () => void {
    let set = this.listeners.get(docId)
    if (!set) {
      set = new Set()
      this.listeners.set(docId, set)
    }
    set.add(listener)

    return () => {
      set!.delete(listener)
      if (set!.size === 0) this.listeners.delete(docId)
    }
  }

  /**
   * Get a serializable snapshot of a document.
   */
  getSnapshot(docId: string): CrdtSnapshot {
    const doc = this.documents.get(docId)
    if (!doc) throw new CrdtError(`Document "${docId}" not found`)

    const ops = this.operationLog.get(docId) ?? []

    return {
      docId: doc.id,
      type: doc.type,
      state: this.serializeState(doc),
      clock: doc.clock,
      operationCount: ops.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  /**
   * Delete a document and all its operations.
   */
  deleteDocument(docId: string): void {
    this.documents.delete(docId)
    this.operationLog.delete(docId)
    this.listeners.delete(docId)
  }

  /**
   * Compact old operations to reduce memory usage.
   */
  compact(docId: string): number {
    const ops = this.operationLog.get(docId)
    if (!ops) return 0

    const removed = ops.length
    this.operationLog.set(docId, [])
    return removed
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  /** @internal Generate and apply a local operation */
  _applyLocal(docId: string, data: CrdtOperation["data"]): CrdtOperation {
    const doc = this.documents.get(docId)!
    doc.clock++

    const op: CrdtOperation = {
      docId,
      type: doc.type,
      operationId: `${doc.clock}:${this.options.nodeId}`,
      nodeId: this.options.nodeId,
      timestamp: Date.now(),
      clock: doc.clock,
      data,
    }

    this.applyOperation(doc, op)

    const ops = this.operationLog.get(docId)!
    ops.push(op)

    this.notifyListeners(docId, doc.state)
    this.options.onOperation(op)
    this.options.onStateChange(docId, this.serializeState(doc))

    return op
  }

  private applyOperation(doc: CrdtDocument, op: CrdtOperation): void {
    switch (op.type) {
      case "lww-register":
        this.applyLwwRegister(doc as CrdtDocument<LwwRegisterState>, op.data as LwwRegisterOp, op)
        break
      case "g-counter":
        this.applyGCounter(doc as CrdtDocument<GCounterState>, op.data as GCounterOp, op)
        break
      case "pn-counter":
        this.applyPnCounter(doc as CrdtDocument<PnCounterState>, op.data as PnCounterOp, op)
        break
      case "or-set":
        this.applyOrSet(doc as CrdtDocument<OrSetState>, op.data as OrSetOp)
        break
      case "rga":
        this.applyRga(doc as CrdtDocument<RgaState>, op.data as RgaOp)
        break
    }
  }

  private applyLwwRegister(
    doc: CrdtDocument<LwwRegisterState>,
    data: LwwRegisterOp,
    op: CrdtOperation,
  ): void {
    const existing = doc.state.values.get(data.key)
    if (
      !existing ||
      op.clock > existing.timestamp ||
      (op.clock === existing.timestamp && op.nodeId > existing.nodeId)
    ) {
      doc.state.values.set(data.key, {
        value: data.value,
        timestamp: op.clock,
        nodeId: op.nodeId,
      })
    }
  }

  private applyGCounter(
    doc: CrdtDocument<GCounterState>,
    data: GCounterOp,
    op: CrdtOperation,
  ): void {
    const current = doc.state.counts.get(op.nodeId) ?? 0
    doc.state.counts.set(op.nodeId, current + data.amount)
  }

  private applyPnCounter(
    doc: CrdtDocument<PnCounterState>,
    data: PnCounterOp,
    op: CrdtOperation,
  ): void {
    if (data.kind === "pn-increment") {
      const current = doc.state.positive.get(op.nodeId) ?? 0
      doc.state.positive.set(op.nodeId, current + data.amount)
    } else {
      const current = doc.state.negative.get(op.nodeId) ?? 0
      doc.state.negative.set(op.nodeId, current + data.amount)
    }
  }

  private applyOrSet(doc: CrdtDocument<OrSetState>, data: OrSetOp): void {
    const key = JSON.stringify(data.element)
    if (data.kind === "or-add") {
      let tags = doc.state.elements.get(key)
      if (!tags) {
        tags = new Set()
        doc.state.elements.set(key, tags)
      }
      tags.add(data.tag)
    } else {
      const tags = doc.state.elements.get(key)
      if (tags) {
        for (const tag of tags) {
          doc.state.tombstones.add(tag)
        }
        doc.state.elements.delete(key)
      }
    }
  }

  private applyRga(doc: CrdtDocument<RgaState>, data: RgaOp): void {
    if (data.kind === "rga-insert") {
      const node: RgaNode = {
        id: data.positionId,
        value: data.value ?? null,
        deleted: false,
        afterId: data.afterId,
      }
      doc.state.nodes.set(data.positionId, node)
      this.insertRgaInOrder(doc.state, node)
    } else {
      const node = doc.state.nodes.get(data.positionId)
      if (node) {
        node.deleted = true
      }
    }
  }

  private insertRgaInOrder(state: RgaState, node: RgaNode): void {
    if (node.afterId === null) {
      let insertIdx = 0
      while (insertIdx < state.order.length) {
        const existingNode = state.nodes.get(state.order[insertIdx])
        if (existingNode && existingNode.afterId === null && existingNode.id > node.id) {
          insertIdx++
        } else {
          break
        }
      }
      state.order.splice(insertIdx, 0, node.id)
    } else {
      const afterIdx = state.order.indexOf(node.afterId)
      if (afterIdx === -1) {
        state.order.push(node.id)
      } else {
        let insertIdx = afterIdx + 1
        while (insertIdx < state.order.length) {
          const existingNode = state.nodes.get(state.order[insertIdx])
          if (existingNode && existingNode.afterId === node.afterId && existingNode.id > node.id) {
            insertIdx++
          } else {
            break
          }
        }
        state.order.splice(insertIdx, 0, node.id)
      }
    }
  }

  private createInitialState(type: CrdtType): unknown {
    switch (type) {
      case "lww-register":
        return { values: new Map() } as LwwRegisterState
      case "g-counter":
        return { counts: new Map() } as GCounterState
      case "pn-counter":
        return { positive: new Map(), negative: new Map() } as PnCounterState
      case "or-set":
        return { elements: new Map(), tombstones: new Set() } as OrSetState
      case "rga":
        return { nodes: new Map(), order: [] } as RgaState
      default:
        throw new CrdtError(`Unknown CRDT type: ${type}`)
    }
  }

  private serializeState(doc: CrdtDocument): unknown {
    switch (doc.type) {
      case "lww-register": {
        const state = doc.state as LwwRegisterState
        const obj: Record<string, unknown> = {}
        for (const [key, entry] of state.values) {
          obj[key] = entry.value
        }
        return obj
      }
      case "g-counter": {
        const state = doc.state as GCounterState
        let total = 0
        for (const v of state.counts.values()) total += v
        return total
      }
      case "pn-counter": {
        const state = doc.state as PnCounterState
        let pos = 0, neg = 0
        for (const v of state.positive.values()) pos += v
        for (const v of state.negative.values()) neg += v
        return pos - neg
      }
      case "or-set": {
        const state = doc.state as OrSetState
        const elements: unknown[] = []
        for (const [key, tags] of state.elements) {
          const hasLiveTags = [...tags].some((t) => !state.tombstones.has(t))
          if (hasLiveTags) elements.push(JSON.parse(key))
        }
        return elements
      }
      case "rga": {
        const state = doc.state as RgaState
        return state.order
          .map((id) => state.nodes.get(id))
          .filter((n) => n && !n.deleted)
          .map((n) => n!.value)
          .join("")
      }
      default:
        return doc.state
    }
  }

  private notifyListeners(docId: string, _state: unknown): void {
    const doc = this.documents.get(docId)
    if (!doc) return

    const serialized = this.serializeState(doc)
    const set = this.listeners.get(docId)
    if (set) {
      for (const listener of set) {
        listener(serialized)
      }
    }
  }
}

// ─── Document Handle ─────────────────────────────────────────────────────────

export class CrdtDocumentHandle {
  constructor(
    private doc: CrdtDocument,
    private engine: CrdtEngine,
  ) {}

  get id(): string {
    return this.doc.id
  }

  get type(): CrdtType {
    return this.doc.type
  }

  get clock(): number {
    return this.doc.clock
  }

  /** LWW-Register: set a key-value pair. */
  set(key: string, value: unknown): CrdtOperation {
    this.assertType("lww-register")
    return this.engine._applyLocal(this.doc.id, { kind: "lww-set", key, value } as LwwRegisterOp)
  }

  /** LWW-Register: get a value by key. */
  get(key: string): unknown {
    this.assertType("lww-register")
    const state = this.doc.state as LwwRegisterState
    return state.values.get(key)?.value
  }

  /** G-Counter / PN-Counter: increment. */
  increment(amount: number = 1): CrdtOperation {
    if (this.doc.type === "g-counter") {
      if (amount < 0) throw new CrdtError("G-Counter cannot be decremented")
      return this.engine._applyLocal(this.doc.id, { kind: "g-increment", amount } as GCounterOp)
    }
    if (this.doc.type === "pn-counter") {
      return this.engine._applyLocal(this.doc.id, { kind: "pn-increment", amount } as PnCounterOp)
    }
    throw new CrdtError(`increment() not supported on ${this.doc.type}`)
  }

  /** PN-Counter: decrement. */
  decrement(amount: number = 1): CrdtOperation {
    this.assertType("pn-counter")
    return this.engine._applyLocal(this.doc.id, { kind: "pn-decrement", amount } as PnCounterOp)
  }

  /** OR-Set: add an element. */
  add(element: unknown): CrdtOperation {
    this.assertType("or-set")
    const tag = `${Date.now()}:${this.engine.nodeId}:${Math.random().toString(36).substring(2, 8)}`
    return this.engine._applyLocal(this.doc.id, { kind: "or-add", element, tag } as OrSetOp)
  }

  /** OR-Set: remove an element. */
  remove(element: unknown): CrdtOperation {
    this.assertType("or-set")
    const tag = `${Date.now()}:${this.engine.nodeId}:remove`
    return this.engine._applyLocal(this.doc.id, { kind: "or-remove", element, tag } as OrSetOp)
  }

  /** RGA: insert text at a position. */
  insertAt(afterId: string | null, value: string): CrdtOperation {
    this.assertType("rga")
    const positionId = `${this.doc.clock + 1}:${this.engine.nodeId}`
    return this.engine._applyLocal(this.doc.id, {
      kind: "rga-insert",
      positionId,
      afterId,
      value,
    } as RgaOp)
  }

  /** RGA: delete a character by position ID. */
  deleteAt(positionId: string): CrdtOperation {
    this.assertType("rga")
    return this.engine._applyLocal(this.doc.id, {
      kind: "rga-delete",
      positionId,
      afterId: null,
    } as RgaOp)
  }

  /** Get the current serialized value of the document. */
  getValue(): unknown {
    return this.engine.getSnapshot(this.doc.id).state
  }

  private assertType(expected: CrdtType): void {
    if (this.doc.type !== expected) {
      throw new CrdtError(`Operation requires type "${expected}", but document is "${this.doc.type}"`)
    }
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class CrdtError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CrdtError"
  }
}
