/**
 * Job Scheduler - persistent job scheduling backed by Postgres.
 * Supports delayed execution, cron schedules, and automatic retries.
 * Uses FOR UPDATE SKIP LOCKED for safe concurrent polling.
 */

import type { Pool } from "pg"

export interface ScheduledJob {
  id: string
  actionRef: string
  args: unknown
  status: "pending" | "running" | "completed" | "failed" | "dead"
  scheduledAt: Date
  startedAt?: Date
  completedAt?: Date
  error?: string
  retries: number
  maxRetries: number
  cronExpression?: string
}

export interface CronDefinition {
  name: string
  cronExpression: string
  actionRef: string
  args: unknown
  timezone?: string
}

export interface SchedulerOptions {
  pollInterval: number
  maxConcurrentJobs: number
  defaultMaxRetries: number
  tableName: string
}

const DEFAULT_OPTIONS: SchedulerOptions = {
  pollInterval: 1000,
  maxConcurrentJobs: 10,
  defaultMaxRetries: 3,
  tableName: "_reactivebase_jobs",
}

export class JobScheduler {
  private options: SchedulerOptions
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private cronDefinitions = new Map<string, CronDefinition>()
  private actionExecutor: ((actionRef: string, args: unknown) => Promise<void>) | null = null
  private running = false

  /**
   * @param pool - Postgres connection pool for job persistence
   * @param options - Partial scheduler configuration overriding defaults
   */
  constructor(
    private pool: Pool,
    options: Partial<SchedulerOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Set the function that executes actions.
   *
   * @param executor - Async function that runs a job given its action reference and arguments
   */
  setExecutor(executor: (actionRef: string, args: unknown) => Promise<void>): void {
    this.actionExecutor = executor
  }

  /**
   * Initialize the jobs table in Postgres.
   */
  async initialize(): Promise<void> {
    const { tableName } = this.options
    const maxRetries = this.options.defaultMaxRetries
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new Error(`Invalid defaultMaxRetries: must be a non-negative integer, got ${maxRetries}`)
    }
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        id text PRIMARY KEY DEFAULT gen_random_uuid(),
        action_ref text NOT NULL,
        args jsonb NOT NULL DEFAULT '{}',
        status text NOT NULL DEFAULT 'pending',
        scheduled_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        completed_at timestamptz,
        error text,
        retries integer NOT NULL DEFAULT 0,
        max_retries integer NOT NULL DEFAULT ${this.options.defaultMaxRetries},
        cron_expression text,
        cron_name text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "${tableName}_poll_idx"
        ON "${tableName}" (status, scheduled_at)
        WHERE status = 'pending';
    `)
  }

  /**
   * Schedule a job to run after a delay.
   *
   * @param delay - Delay as milliseconds (number) or human-readable string (e.g. "5s", "10m")
   * @param actionRef - Identifier of the action to execute
   * @param args - Arguments passed to the action executor
   * @param maxRetries - Maximum retry attempts on failure, overriding the default
   * @returns The unique ID of the newly created job
   */
  async runAfter(delay: string | number, actionRef: string, args: unknown = {}, maxRetries?: number): Promise<string> {
    const delayMs = typeof delay === "number" ? delay : parseDelay(delay)
    const scheduledAt = new Date(Date.now() + delayMs)
    return this.scheduleAt(scheduledAt, actionRef, args, maxRetries)
  }

  /**
   * Schedule a job to run at a specific time.
   *
   * @param date - The date and time when the job should execute
   * @param actionRef - Identifier of the action to execute
   * @param args - Arguments passed to the action executor
   * @param maxRetries - Maximum retry attempts on failure, overriding the default
   * @returns The unique ID of the newly created job
   */
  async scheduleAt(date: Date, actionRef: string, args: unknown = {}, maxRetries?: number): Promise<string> {
    const { tableName } = this.options
    const result = await this.pool.query(
      `INSERT INTO "${tableName}" (action_ref, args, scheduled_at, max_retries)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [actionRef, JSON.stringify(args), date, maxRetries ?? this.options.defaultMaxRetries],
    )
    return result.rows[0].id
  }

  /**
   * Register a cron job definition.
   *
   * @param definition - Cron job definition including schedule, action, and arguments
   */
  defineCron(definition: CronDefinition): void {
    this.cronDefinitions.set(definition.name, definition)
  }

  /**
   * Start the scheduler polling loop.
   */
  start(): void {
    if (this.running) return
    this.running = true

    // Schedule initial cron jobs
    this.scheduleCronJobs().catch((err) => console.error("Failed to schedule cron jobs:", err))

    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => console.error("Scheduler poll error:", err))
    }, this.options.pollInterval)
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    this.running = false
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /**
   * Get job status by ID.
   *
   * @param jobId - The unique identifier of the job to retrieve
   * @returns The scheduled job if found, or null if no job exists with the given ID
   */
  async getJob(jobId: string): Promise<ScheduledJob | null> {
    const { tableName } = this.options
    const result = await this.pool.query(`SELECT * FROM "${tableName}" WHERE id = $1`, [jobId])
    return result.rows.length > 0 ? mapJobRow(result.rows[0]) : null
  }

  /**
   * Cancel a pending job.
   *
   * @param jobId - The unique identifier of the job to cancel
   * @returns True if the job was cancelled, false if it was not found or not pending
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const { tableName } = this.options
    const result = await this.pool.query(
      `DELETE FROM "${tableName}" WHERE id = $1 AND status = 'pending' RETURNING id`,
      [jobId],
    )
    return result.rowCount! > 0
  }

  /**
   * Poll for and execute ready jobs.
   */
  private async poll(): Promise<void> {
    if (!this.actionExecutor) return

    const { tableName, maxConcurrentJobs } = this.options

    // Claim jobs using FOR UPDATE SKIP LOCKED
    const result = await this.pool.query(
      `UPDATE "${tableName}"
       SET status = 'running', started_at = now()
       WHERE id IN (
         SELECT id FROM "${tableName}"
         WHERE status = 'pending' AND scheduled_at <= now()
         ORDER BY scheduled_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [maxConcurrentJobs],
    )

    const jobs = result.rows.map(mapJobRow)

    await Promise.all(jobs.map((job) => this.executeJob(job)))
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    const { tableName } = this.options

    try {
      await this.actionExecutor!(job.actionRef, job.args)

      await this.pool.query(`UPDATE "${tableName}" SET status = 'completed', completed_at = now() WHERE id = $1`, [
        job.id,
      ])

      // If this was a cron job, schedule the next occurrence
      if (job.cronExpression) {
        const nextRun = getNextCronRun(job.cronExpression)
        if (nextRun) {
          await this.pool.query(
            `INSERT INTO "${tableName}" (action_ref, args, scheduled_at, cron_expression, cron_name, max_retries)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              job.actionRef,
              JSON.stringify(job.args),
              nextRun,
              job.cronExpression,
              (job as unknown as Record<string, unknown>).cronName,
              job.maxRetries,
            ],
          )
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (job.retries < job.maxRetries) {
        // Retry with exponential backoff
        const backoffMs = Math.min(1000 * Math.pow(2, job.retries), 60_000)
        const retryAt = new Date(Date.now() + backoffMs)

        await this.pool.query(
          `UPDATE "${tableName}" SET status = 'pending', scheduled_at = $2, retries = retries + 1, error = $3 WHERE id = $1`,
          [job.id, retryAt, errorMessage],
        )
      } else {
        // Mark as dead
        await this.pool.query(
          `UPDATE "${tableName}" SET status = 'dead', completed_at = now(), error = $2 WHERE id = $1`,
          [job.id, errorMessage],
        )
      }
    }
  }

  private async scheduleCronJobs(): Promise<void> {
    const { tableName } = this.options

    for (const [name, def] of this.cronDefinitions) {
      // Check if a pending job already exists for this cron
      const existing = await this.pool.query(
        `SELECT id FROM "${tableName}" WHERE cron_name = $1 AND status = 'pending' LIMIT 1`,
        [name],
      )

      if (existing.rows.length === 0) {
        const nextRun = getNextCronRun(def.cronExpression)
        if (nextRun) {
          await this.pool.query(
            `INSERT INTO "${tableName}" (action_ref, args, scheduled_at, cron_expression, cron_name)
             VALUES ($1, $2, $3, $4, $5)`,
            [def.actionRef, JSON.stringify(def.args), nextRun, def.cronExpression, name],
          )
        }
      }
    }
  }
}

/**
 * Parse a delay string like "5s", "10m", "1h" into milliseconds.
 *
 * @param delay - Human-readable delay string (e.g. "5s", "10m", "1h", "2d") or numeric string
 * @returns The delay in milliseconds
 */
export function parseDelay(delay: string): number {
  const match = delay.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/)
  if (!match) {
    // Try plain number (treat as ms)
    const num = Number(delay)
    if (!isNaN(num)) return num
    throw new Error(`Invalid delay format: "${delay}". Use "5s", "10m", "1h", etc.`)
  }

  const value = parseFloat(match[1])
  const unit = match[2]

  switch (unit) {
    case "ms":
      return value
    case "s":
      return value * 1000
    case "m":
      return value * 60_000
    case "h":
      return value * 3_600_000
    case "d":
      return value * 86_400_000
    default:
      return value
  }
}

/**
 * Get the next run time for a cron expression.
 * Supports basic cron syntax: minute hour day-of-month month day-of-week
 *
 * @param expression - Cron expression with 5 space-separated fields
 * @returns The next matching date within 24 hours, or null if no match is found
 */
export function getNextCronRun(expression: string): Date | null {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const now = new Date()
  const candidate = new Date(now)
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  // Try up to 1440 minutes (24h) to find next match
  for (let i = 0; i < 1440; i++) {
    if (cronMatches(parts, candidate)) {
      return candidate
    }
    candidate.setMinutes(candidate.getMinutes() + 1)
  }

  return null
}

function cronMatches(parts: string[], date: Date): boolean {
  const [minuteExpr, hourExpr, dayExpr, monthExpr, dowExpr] = parts

  return (
    fieldMatches(minuteExpr, date.getMinutes()) &&
    fieldMatches(hourExpr, date.getHours()) &&
    fieldMatches(dayExpr, date.getDate()) &&
    fieldMatches(monthExpr, date.getMonth() + 1) &&
    fieldMatches(dowExpr, date.getDay())
  )
}

function fieldMatches(expr: string, value: number): boolean {
  if (expr === "*") return true

  // Handle */N interval
  if (expr.startsWith("*/")) {
    const interval = parseInt(expr.substring(2), 10)
    return value % interval === 0
  }

  // Handle comma-separated values
  if (expr.includes(",")) {
    return expr.split(",").some((v) => parseInt(v, 10) === value)
  }

  // Handle range
  if (expr.includes("-")) {
    const [start, end] = expr.split("-").map((v) => parseInt(v, 10))
    return value >= start && value <= end
  }

  return parseInt(expr, 10) === value
}

function mapJobRow(row: Record<string, unknown>): ScheduledJob {
  return {
    id: row.id as string,
    actionRef: row.action_ref as string,
    args: row.args,
    status: row.status as ScheduledJob["status"],
    scheduledAt: new Date(row.scheduled_at as string),
    startedAt: row.started_at ? new Date(row.started_at as string) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
    error: row.error as string | undefined,
    retries: row.retries as number,
    maxRetries: row.max_retries as number,
    cronExpression: row.cron_expression as string | undefined,
  }
}
