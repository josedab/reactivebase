/**
 * Reactive Query Composition & Derived Queries
 *
 * Enables declarative composition of queries where derived queries automatically
 * subscribe to their source queries. Supports combineQueries(), deriveQuery(),
 * and transformQuery() operators that create reactive DAGs with incremental
 * change propagation.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type QueryNodeStatus = "idle" | "pending" | "active" | "error" | "disposed"

export interface QuerySource<T = unknown> {
  readonly id: string
  readonly queryName: string
  readonly args: unknown
  currentValue: T | undefined
  version: number
  status: QueryNodeStatus
}

export interface DerivedQueryNode<T = unknown> {
  readonly id: string
  readonly sourceIds: string[]
  transform: (...sourceValues: unknown[]) => T
  currentValue: T | undefined
  version: number
  status: QueryNodeStatus
}

export type DAGNode<T = unknown> = QuerySource<T> | DerivedQueryNode<T>

export type DAGChangeListener = (nodeId: string, value: unknown, version: number) => void

export interface QueryCompositionOptions {
  maxDAGDepth: number
  batchPropagation: boolean
}

const DEFAULT_OPTIONS: QueryCompositionOptions = {
  maxDAGDepth: 10,
  batchPropagation: true,
}

// ── Reactive DAG Engine ──────────────────────────────────────────────────────

export class ReactiveQueryDAG {
  private sources = new Map<string, QuerySource>()
  private derived = new Map<string, DerivedQueryNode>()
  private dependents = new Map<string, Set<string>>()
  private listeners = new Set<DAGChangeListener>()
  private options: QueryCompositionOptions
  private nodeCounter = 0

  constructor(options: Partial<QueryCompositionOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Register a source query node in the DAG.
   */
  addSource<T>(queryName: string, args: unknown): QuerySource<T> {
    const id = `src_${++this.nodeCounter}`
    const source: QuerySource<T> = {
      id,
      queryName,
      args,
      currentValue: undefined,
      version: 0,
      status: "idle",
    }
    this.sources.set(id, source as QuerySource)
    return source
  }

  /**
   * Create a derived query that transforms one or more source queries.
   */
  deriveQuery<T>(sourceIds: string[], transform: (...values: unknown[]) => T): DerivedQueryNode<T> {
    // Validate sources exist
    for (const sid of sourceIds) {
      if (!this.sources.has(sid) && !this.derived.has(sid)) {
        throw new Error(`Unknown source node: "${sid}"`)
      }
    }

    // Check DAG depth limit
    const depth = this.calculateDepth(sourceIds)
    if (depth >= this.options.maxDAGDepth) {
      throw new Error(`DAG depth limit exceeded (max: ${this.options.maxDAGDepth})`)
    }

    const id = `derived_${++this.nodeCounter}`
    const node: DerivedQueryNode<T> = {
      id,
      sourceIds,
      transform,
      currentValue: undefined,
      version: 0,
      status: "idle",
    }

    this.derived.set(id, node as DerivedQueryNode)

    // Register this node as dependent of each source
    for (const sid of sourceIds) {
      if (!this.dependents.has(sid)) {
        this.dependents.set(sid, new Set())
      }
      this.dependents.get(sid)!.add(id)
    }

    return node
  }

  /**
   * Combine multiple queries into a single derived query.
   */
  combineQueries<T>(sourceIds: string[], combiner: (...values: unknown[]) => T): DerivedQueryNode<T> {
    return this.deriveQuery(sourceIds, combiner)
  }

  /**
   * Create a transform over a single source.
   */
  transformQuery<TIn, TOut>(sourceId: string, transform: (value: TIn) => TOut): DerivedQueryNode<TOut> {
    return this.deriveQuery([sourceId], (value) => transform(value as TIn))
  }

  /**
   * Update a source node's value and propagate changes through the DAG.
   */
  updateSource(sourceId: string, value: unknown, version: number): void {
    const source = this.sources.get(sourceId)
    if (!source) throw new Error(`Unknown source: "${sourceId}"`)

    source.currentValue = value
    source.version = version
    source.status = "active"

    this.notifyListeners(sourceId, value, version)

    // Propagate to dependents
    this.propagateChanges(sourceId)
  }

  /**
   * Propagate changes through the DAG using topological order.
   */
  private propagateChanges(changedNodeId: string): void {
    const visited = new Set<string>()
    const queue = [changedNodeId]

    while (queue.length > 0) {
      const currentId = queue.shift()!
      if (visited.has(currentId)) continue
      visited.add(currentId)

      const deps = this.dependents.get(currentId)
      if (!deps) continue

      for (const depId of deps) {
        const derivedNode = this.derived.get(depId)
        if (!derivedNode) continue

        // Check all sources are available
        const sourceValues = derivedNode.sourceIds.map((sid) => {
          const src = this.sources.get(sid)
          if (src) return src.currentValue
          const der = this.derived.get(sid)
          return der?.currentValue
        })

        const allSourcesReady = sourceValues.every((v) => v !== undefined)
        if (!allSourcesReady) continue

        try {
          const newValue = derivedNode.transform(...sourceValues)
          derivedNode.currentValue = newValue
          derivedNode.version++
          derivedNode.status = "active"

          this.notifyListeners(depId, newValue, derivedNode.version)
          queue.push(depId)
        } catch (error: unknown) {
          derivedNode.status = "error"
          console.error(`Error propagating to derived node ${depId}:`, error)
        }
      }
    }
  }

  /**
   * Register a change listener for DAG updates.
   */
  onChange(listener: DAGChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Dispose a node and clean up its dependents.
   */
  dispose(nodeId: string): void {
    const source = this.sources.get(nodeId)
    if (source) {
      source.status = "disposed"
      this.sources.delete(nodeId)
    }

    const derived = this.derived.get(nodeId)
    if (derived) {
      derived.status = "disposed"
      this.derived.delete(nodeId)

      // Remove from parent dependency lists
      for (const sid of derived.sourceIds) {
        this.dependents.get(sid)?.delete(nodeId)
      }
    }

    // Dispose all dependents
    const deps = this.dependents.get(nodeId)
    if (deps) {
      for (const depId of deps) {
        this.dispose(depId)
      }
      this.dependents.delete(nodeId)
    }
  }

  getNode(nodeId: string): DAGNode | undefined {
    return this.sources.get(nodeId) ?? this.derived.get(nodeId)
  }

  getAllSources(): QuerySource[] {
    return Array.from(this.sources.values())
  }

  getAllDerived(): DerivedQueryNode[] {
    return Array.from(this.derived.values())
  }

  get nodeCount(): number {
    return this.sources.size + this.derived.size
  }

  /**
   * Get the topological order for processing.
   */
  getTopologicalOrder(): string[] {
    const result: string[] = []
    const visited = new Set<string>()

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return
      visited.add(nodeId)

      const derived = this.derived.get(nodeId)
      if (derived) {
        for (const sid of derived.sourceIds) {
          visit(sid)
        }
      }

      result.push(nodeId)
    }

    for (const id of this.sources.keys()) visit(id)
    for (const id of this.derived.keys()) visit(id)

    return result
  }

  private calculateDepth(sourceIds: string[]): number {
    let maxDepth = 0
    for (const sid of sourceIds) {
      const derived = this.derived.get(sid)
      if (derived) {
        const depth = 1 + this.calculateDepth(derived.sourceIds)
        maxDepth = Math.max(maxDepth, depth)
      }
    }
    return maxDepth
  }

  private notifyListeners(nodeId: string, value: unknown, version: number): void {
    for (const listener of this.listeners) {
      listener(nodeId, value, version)
    }
  }
}
