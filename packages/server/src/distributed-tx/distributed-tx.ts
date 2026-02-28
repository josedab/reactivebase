/**
 * Distributed Transaction Coordinator
 *
 * Two-phase commit (2PC) coordinator for transactions spanning multiple PostgreSQL
 * instances in multi-region deployments. Supports saga patterns with compensating
 * transactions and dead-letter recovery for failed distributed operations.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type TransactionStatus =
  | "preparing"
  | "prepared"
  | "committing"
  | "committed"
  | "aborting"
  | "aborted"
  | "failed"

export type SagaStepStatus = "pending" | "executing" | "completed" | "compensating" | "compensated" | "failed"

export interface TransactionParticipant {
  readonly id: string
  readonly connectionString: string
  readonly name: string
}

export interface TransactionRecord {
  readonly transactionId: string
  status: TransactionStatus
  participants: string[]
  readonly createdAt: Date
  updatedAt: Date
  error?: string
}

export interface PrepareResult {
  participantId: string
  success: boolean
  error?: string
}

export interface CoordinatorOptions {
  prepareTimeoutMs: number
  commitTimeoutMs: number
  maxRetries: number
  deadLetterEnabled: boolean
}

const DEFAULT_COORDINATOR_OPTIONS: CoordinatorOptions = {
  prepareTimeoutMs: 10_000,
  commitTimeoutMs: 15_000,
  maxRetries: 3,
  deadLetterEnabled: true,
}

// ── Dead Letter Queue ────────────────────────────────────────────────────────

export interface DeadLetterEntry {
  readonly transactionId: string
  readonly error: string
  readonly participantStates: Map<string, TransactionStatus>
  readonly timestamp: Date
  retryCount: number
}

export class DeadLetterQueue {
  private entries = new Map<string, DeadLetterEntry>()

  add(entry: DeadLetterEntry): void {
    this.entries.set(entry.transactionId, entry)
  }

  get(transactionId: string): DeadLetterEntry | undefined {
    return this.entries.get(transactionId)
  }

  remove(transactionId: string): boolean {
    return this.entries.delete(transactionId)
  }

  getAll(): DeadLetterEntry[] {
    return Array.from(this.entries.values())
  }

  get size(): number {
    return this.entries.size
  }
}

// ── Two-Phase Commit Coordinator ─────────────────────────────────────────────

export type ParticipantAdapter = {
  prepare(participantId: string, transactionId: string, operations: unknown[]): Promise<PrepareResult>
  commit(participantId: string, transactionId: string): Promise<void>
  rollback(participantId: string, transactionId: string): Promise<void>
}

export class TwoPhaseCommitCoordinator {
  private transactions = new Map<string, TransactionRecord>()
  private participants = new Map<string, TransactionParticipant>()
  private deadLetterQueue: DeadLetterQueue
  private options: CoordinatorOptions
  private transactionCounter = 0

  constructor(
    private adapter: ParticipantAdapter,
    options: Partial<CoordinatorOptions> = {},
  ) {
    this.options = { ...DEFAULT_COORDINATOR_OPTIONS, ...options }
    this.deadLetterQueue = new DeadLetterQueue()
  }

  /**
   * Register a participant (database instance) in the distributed transaction.
   */
  registerParticipant(participant: TransactionParticipant): void {
    this.participants.set(participant.id, participant)
  }

  /**
   * Remove a participant.
   */
  removeParticipant(id: string): void {
    this.participants.delete(id)
  }

  /**
   * Execute a distributed transaction across specified participants.
   */
  async executeTransaction(
    participantIds: string[],
    operations: Map<string, unknown[]>,
  ): Promise<{ transactionId: string; status: TransactionStatus }> {
    const transactionId = `dtx_${++this.transactionCounter}_${Date.now()}`

    // Validate participants exist
    for (const pid of participantIds) {
      if (!this.participants.has(pid)) {
        throw new Error(`Unknown participant: "${pid}"`)
      }
    }

    const record: TransactionRecord = {
      transactionId,
      status: "preparing",
      participants: participantIds,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.transactions.set(transactionId, record)

    try {
      // Phase 1: Prepare
      const prepareResults = await this.preparePhase(transactionId, participantIds, operations)
      const allPrepared = prepareResults.every((r) => r.success)

      if (!allPrepared) {
        // Abort: at least one participant failed to prepare
        await this.abortPhase(transactionId, participantIds)
        const failedParticipants = prepareResults.filter((r) => !r.success).map((r) => r.participantId)
        record.status = "aborted"
        record.error = `Prepare failed for: ${failedParticipants.join(", ")}`
        record.updatedAt = new Date()
        return { transactionId, status: "aborted" }
      }

      record.status = "prepared"
      record.updatedAt = new Date()

      // Phase 2: Commit
      await this.commitPhase(transactionId, participantIds)
      record.status = "committed"
      record.updatedAt = new Date()

      return { transactionId, status: "committed" }
    } catch (error: unknown) {
      record.status = "failed"
      record.error = error instanceof Error ? error.message : String(error)
      record.updatedAt = new Date()

      if (this.options.deadLetterEnabled) {
        this.deadLetterQueue.add({
          transactionId,
          error: record.error,
          participantStates: new Map(participantIds.map((pid) => [pid, record.status])),
          timestamp: new Date(),
          retryCount: 0,
        })
      }

      return { transactionId, status: "failed" }
    }
  }

  /**
   * Retry a failed transaction from the dead letter queue.
   */
  async retryDeadLetter(transactionId: string): Promise<boolean> {
    const entry = this.deadLetterQueue.get(transactionId)
    if (!entry) return false
    if (entry.retryCount >= this.options.maxRetries) return false

    entry.retryCount++

    const record = this.transactions.get(transactionId)
    if (!record) return false

    try {
      // Attempt to rollback all participants cleanly
      await this.abortPhase(transactionId, record.participants)
      this.deadLetterQueue.remove(transactionId)
      record.status = "aborted"
      record.updatedAt = new Date()
      return true
    } catch {
      return false
    }
  }

  getTransaction(transactionId: string): TransactionRecord | undefined {
    return this.transactions.get(transactionId)
  }

  getDeadLetterQueue(): DeadLetterQueue {
    return this.deadLetterQueue
  }

  private async preparePhase(
    transactionId: string,
    participantIds: string[],
    operations: Map<string, unknown[]>,
  ): Promise<PrepareResult[]> {
    const preparePromises = participantIds.map((pid) => {
      const ops = operations.get(pid) ?? []
      return withTimeout(
        this.adapter.prepare(pid, transactionId, ops),
        this.options.prepareTimeoutMs,
        `Prepare timeout for participant ${pid}`,
      )
    })

    return Promise.all(preparePromises)
  }

  private async commitPhase(transactionId: string, participantIds: string[]): Promise<void> {
    const commitPromises = participantIds.map((pid) =>
      withTimeout(
        this.adapter.commit(pid, transactionId),
        this.options.commitTimeoutMs,
        `Commit timeout for participant ${pid}`,
      ),
    )

    await Promise.all(commitPromises)
  }

  private async abortPhase(transactionId: string, participantIds: string[]): Promise<void> {
    const rollbackPromises = participantIds.map((pid) =>
      this.adapter.rollback(pid, transactionId).catch((err: unknown) => {
        console.error(`Rollback failed for participant ${pid} in transaction ${transactionId}:`, err)
      }),
    )

    await Promise.all(rollbackPromises)
  }
}

// ── Saga Runtime ─────────────────────────────────────────────────────────────

export interface SagaStep<TContext = unknown> {
  readonly name: string
  execute(context: TContext): Promise<TContext>
  compensate(context: TContext): Promise<TContext>
}

export interface SagaStepRecord {
  stepName: string
  status: SagaStepStatus
  startedAt?: Date
  completedAt?: Date
  error?: string
}

export interface SagaExecutionResult<TContext = unknown> {
  readonly sagaId: string
  readonly success: boolean
  readonly context: TContext
  readonly steps: SagaStepRecord[]
  readonly completedAt: Date
}

export interface SagaOptions {
  maxCompensationRetries: number
  onStepComplete?: (stepName: string, context: unknown) => void
  onStepFailed?: (stepName: string, error: Error) => void
  onCompensationComplete?: (stepName: string) => void
}

const DEFAULT_SAGA_OPTIONS: SagaOptions = {
  maxCompensationRetries: 3,
}

export class SagaOrchestrator<TContext = unknown> {
  private steps: SagaStep<TContext>[] = []
  private options: SagaOptions
  private sagaCounter = 0

  constructor(options: Partial<SagaOptions> = {}) {
    this.options = { ...DEFAULT_SAGA_OPTIONS, ...options }
  }

  /**
   * Add a step to the saga pipeline.
   */
  addStep(step: SagaStep<TContext>): this {
    this.steps.push(step)
    return this
  }

  /**
   * Execute the saga: run steps in order, compensate on failure.
   */
  async execute(initialContext: TContext): Promise<SagaExecutionResult<TContext>> {
    const sagaId = `saga_${++this.sagaCounter}_${Date.now()}`
    const stepRecords: SagaStepRecord[] = this.steps.map((s) => ({
      stepName: s.name,
      status: "pending" as SagaStepStatus,
    }))

    let context = initialContext
    let failedAtIndex = -1

    // Forward execution
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i]
      const record = stepRecords[i]
      record.status = "executing"
      record.startedAt = new Date()

      try {
        context = await step.execute(context)
        record.status = "completed"
        record.completedAt = new Date()
        this.options.onStepComplete?.(step.name, context)
      } catch (error: unknown) {
        record.status = "failed"
        record.error = error instanceof Error ? error.message : String(error)
        record.completedAt = new Date()
        failedAtIndex = i
        this.options.onStepFailed?.(step.name, error instanceof Error ? error : new Error(String(error)))
        break
      }
    }

    // Compensate on failure (reverse order up to failed step)
    if (failedAtIndex >= 0) {
      for (let i = failedAtIndex - 1; i >= 0; i--) {
        const step = this.steps[i]
        const record = stepRecords[i]
        record.status = "compensating"

        let compensated = false
        for (let retry = 0; retry < this.options.maxCompensationRetries; retry++) {
          try {
            context = await step.compensate(context)
            record.status = "compensated"
            compensated = true
            this.options.onCompensationComplete?.(step.name)
            break
          } catch {
            // Retry compensation
          }
        }

        if (!compensated) {
          record.status = "failed"
          record.error = `Compensation failed after ${this.options.maxCompensationRetries} retries`
        }
      }
    }

    return {
      sagaId,
      success: failedAtIndex < 0,
      context,
      steps: stepRecords,
      completedAt: new Date(),
    }
  }
}

// ── Distributed Trace Span ───────────────────────────────────────────────────

export interface TraceSpan {
  readonly spanId: string
  readonly traceId: string
  readonly parentSpanId?: string
  readonly operationName: string
  readonly startTime: number
  endTime?: number
  readonly tags: Record<string, string>
  readonly events: TraceEvent[]
}

export interface TraceEvent {
  readonly name: string
  readonly timestamp: number
  readonly attributes?: Record<string, string>
}

export class DistributedTracer {
  private activeSpans = new Map<string, TraceSpan>()
  private completedSpans: TraceSpan[] = []
  private spanCounter = 0

  startSpan(traceId: string, operationName: string, parentSpanId?: string): TraceSpan {
    const spanId = `span_${++this.spanCounter}_${Date.now()}`
    const span: TraceSpan = {
      spanId,
      traceId,
      parentSpanId,
      operationName,
      startTime: performance.now(),
      tags: {},
      events: [],
    }
    this.activeSpans.set(spanId, span)
    return span
  }

  addEvent(spanId: string, name: string, attributes?: Record<string, string>): void {
    const span = this.activeSpans.get(spanId)
    if (!span) return
    ;(span.events as TraceEvent[]).push({
      name,
      timestamp: performance.now(),
      attributes,
    })
  }

  endSpan(spanId: string): TraceSpan | undefined {
    const span = this.activeSpans.get(spanId)
    if (!span) return undefined
    ;(span as { endTime?: number }).endTime = performance.now()
    this.activeSpans.delete(spanId)
    this.completedSpans.push(span)
    return span
  }

  getCompletedSpans(traceId?: string): TraceSpan[] {
    if (traceId) return this.completedSpans.filter((s) => s.traceId === traceId)
    return [...this.completedSpans]
  }

  clearCompletedSpans(): void {
    this.completedSpans = []
  }
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export interface DistributedTxMetrics {
  totalTransactions: number
  committedCount: number
  abortedCount: number
  failedCount: number
  averagePrepareTimeMs: number
  averageCommitTimeMs: number
  deadLetterQueueSize: number
  sagaExecutions: number
  sagaSuccessCount: number
  sagaCompensationCount: number
}

// ── Utilities ────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
