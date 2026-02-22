import { describe, it, expect, vi, beforeEach } from "vitest"
import { JobScheduler } from "../scheduler/scheduler.js"

/**
 * Mock Postgres pool and client for testing scheduler lifecycle
 * without a real database.
 */
function createMockPool() {
  const rows: Record<string, unknown>[] = []
  let idCounter = 0

  const queryFn = async (sql: string, params?: unknown[]) => {
    const sqlTrimmed = sql.replace(/\s+/g, " ").trim()

    // CREATE TABLE / INDEX
    if (sqlTrimmed.includes("CREATE TABLE") || sqlTrimmed.includes("CREATE INDEX")) {
      return { rows: [], rowCount: 0 }
    }

    // INSERT ... RETURNING id
    if (sqlTrimmed.includes("INSERT") && sqlTrimmed.includes("RETURNING id")) {
      const id = `job_${++idCounter}`
      const row: Record<string, unknown> = {
        id,
        action_ref: params?.[0],
        args: params?.[1] ? JSON.parse(params[1] as string) : {},
        status: "pending",
        scheduled_at: params?.[2] ?? new Date(),
        started_at: null,
        completed_at: null,
        error: null,
        retries: 0,
        max_retries: params?.[3] ?? 3,
        cron_expression: params?.[4] ?? null,
        cron_name: params?.[5] ?? null,
      }
      rows.push(row)
      return { rows: [{ id }], rowCount: 1 }
    }

    // INSERT without RETURNING (cron re-schedule)
    if (sqlTrimmed.includes("INSERT")) {
      const id = `job_${++idCounter}`
      rows.push({
        id,
        action_ref: params?.[0],
        args: params?.[1] ? JSON.parse(params[1] as string) : {},
        status: "pending",
        scheduled_at: params?.[2],
        cron_expression: params?.[3] ?? null,
        cron_name: params?.[4] ?? null,
        retries: 0,
        max_retries: params?.[5] ?? 3,
      })
      return { rows: [], rowCount: 1 }
    }

    // SELECT by id (only for standalone SELECT queries, not subqueries in UPDATEs)
    if (sqlTrimmed.startsWith("SELECT") && sqlTrimmed.includes("WHERE id")) {
      const id = params?.[0]
      const row = rows.find((r) => r.id === id)
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
    }

    // SELECT pending for cron check
    if (sqlTrimmed.startsWith("SELECT") && sqlTrimmed.includes("cron_name")) {
      const cronName = params?.[0]
      const pending = rows.filter(
        (r) => r.cron_name === cronName && r.status === "pending",
      )
      return { rows: pending, rowCount: pending.length }
    }

    // UPDATE ... SET status = 'running' ... RETURNING * (claim jobs for polling)
    if (sqlTrimmed.includes("SET status = 'running'") && sqlTrimmed.includes("RETURNING *")) {
      const limit = params?.[0] as number ?? 10
      const ready = rows
        .filter((r) => r.status === "pending")
        .slice(0, limit)

      for (const r of ready) {
        r.status = "running"
        r.started_at = new Date()
      }

      return { rows: [...ready], rowCount: ready.length }
    }

    // UPDATE for dead letter
    if (sqlTrimmed.includes("status = 'dead'")) {
      const id = params?.[0]
      const row = rows.find((r) => r.id === id)
      if (row) {
        row.status = "dead"
        row.completed_at = new Date()
        row.error = params?.[1]
      }
      return { rows: [], rowCount: row ? 1 : 0 }
    }

    // UPDATE status to completed
    if (sqlTrimmed.includes("status = 'completed'")) {
      const id = params?.[0]
      const row = rows.find((r) => r.id === id)
      if (row) {
        row.status = "completed"
        row.completed_at = new Date()
      }
      return { rows: [], rowCount: row ? 1 : 0 }
    }

    // UPDATE for retry (status back to pending)
    if (sqlTrimmed.includes("retries = retries + 1")) {
      const id = params?.[0]
      const row = rows.find((r) => r.id === id)
      if (row) {
        row.status = "pending"
        row.scheduled_at = params?.[1]
        row.retries = (row.retries as number) + 1
        row.error = params?.[2]
      }
      return { rows: [], rowCount: row ? 1 : 0 }
    }

    // DELETE (cancel)
    if (sqlTrimmed.includes("DELETE")) {
      const id = params?.[0]
      const idx = rows.findIndex((r) => r.id === id && r.status === "pending")
      if (idx >= 0) {
        rows.splice(idx, 1)
        return { rows: [{ id }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }

    return { rows: [], rowCount: 0 }
  }

  const pool = {
    query: vi.fn().mockImplementation(queryFn),
    _rows: rows,
  }

  return pool as unknown as import("pg").Pool & { _rows: Record<string, unknown>[] }
}

describe("JobScheduler integration", () => {
  let pool: ReturnType<typeof createMockPool>
  let scheduler: JobScheduler

  beforeEach(() => {
    pool = createMockPool()
    scheduler = new JobScheduler(pool, { pollInterval: 50, defaultMaxRetries: 2 })
  })

  it("initializes the jobs table", async () => {
    await scheduler.initialize()
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE"))
  })

  it("schedules and retrieves a job", async () => {
    await scheduler.initialize()
    const jobId = await scheduler.runAfter(0, "sendEmail", { to: "test@example.com" })
    expect(jobId).toBeDefined()

    const job = await scheduler.getJob(jobId)
    expect(job).not.toBeNull()
    expect(job!.actionRef).toBe("sendEmail")
    expect(job!.status).toBe("pending")
  })

  it("cancels a pending job", async () => {
    await scheduler.initialize()
    const jobId = await scheduler.runAfter(60_000, "slowAction", {})
    const cancelled = await scheduler.cancelJob(jobId)
    expect(cancelled).toBe(true)
  })

  it("parses delay strings correctly", async () => {
    await scheduler.initialize()
    const jobId = await scheduler.runAfter("5s", "delayedAction", {})
    expect(jobId).toBeDefined()

    const job = await scheduler.getJob(jobId)
    const delayMs = job!.scheduledAt.getTime() - Date.now()
    // Should be roughly 5 seconds in the future (allow 1s tolerance)
    expect(delayMs).toBeGreaterThan(3500)
    expect(delayMs).toBeLessThan(6500)
  })

  it("executes ready jobs via polling", async () => {
    await scheduler.initialize()
    const executed: string[] = []
    scheduler.setExecutor(async (actionRef, _args) => {
      executed.push(actionRef)
    })

    // Schedule an immediate job
    await scheduler.runAfter(0, "instantAction", { key: "value" })

    // Verify the job was inserted
    const inserted = pool._rows.filter((r) => r.action_ref === "instantAction")
    expect(inserted.length).toBe(1)
    expect(inserted[0].status).toBe("pending")

    // Manually trigger one poll cycle
    const beforePollCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.length
    await (scheduler as any).poll()

    // Check if the row was processed (status should be "completed" after successful execution)
    const processedRows = pool._rows.filter(r => r.action_ref === "instantAction")
    expect(processedRows.length).toBe(1)
    expect(processedRows[0].status).toBe("completed")

    expect(executed).toContain("instantAction")
  })

  it("retries failed jobs with backoff", async () => {
    await scheduler.initialize()
    let attempts = 0
    scheduler.setExecutor(async () => {
      attempts++
      throw new Error("Temporary failure")
    })

    await scheduler.runAfter(0, "flakyAction", {})

    // First poll: fails, should retry
    await (scheduler as any).poll()
    expect(attempts).toBe(1)

    // Verify job was rescheduled (status back to pending with incremented retries)
    const pending = pool._rows.filter((r) => r.action_ref === "flakyAction" && r.status === "pending")
    expect(pending.length).toBe(1)
    expect((pending[0].retries as number)).toBe(1)
  })

  it("marks jobs as dead after max retries", async () => {
    await scheduler.initialize()
    scheduler.setExecutor(async () => {
      throw new Error("Permanent failure")
    })

    await scheduler.runAfter(0, "deadAction", {}, 0) // max 0 retries

    await (scheduler as any).poll()

    // With maxRetries=0, job should immediately go to dead status
    const allDeadAction = pool._rows.filter((r) => r.action_ref === "deadAction")
    expect(allDeadAction.length).toBeGreaterThan(0)
    const dead = allDeadAction.filter((r) => r.status === "dead")
    expect(dead.length).toBe(1)
    expect(dead[0].error).toBe("Permanent failure")
  })
})
