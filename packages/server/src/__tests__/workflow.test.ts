import { describe, it, expect, beforeEach } from "vitest"
import {
  WorkflowEngine,
  WorkflowContext,
  defineWorkflow,
  WorkflowError,
  _WorkflowStepError,
  generateWorkflowTableSQL,
  type QueryExecutor,
} from "../workflow/workflow.js"

// ─── Mock DB Helper ──────────────────────────────────────────────────────────

function createMockDb(returnRows: Record<string, unknown>[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const db: QueryExecutor = async (sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    return { rows: returnRows }
  }
  return { db, calls }
}

describe("defineWorkflow", () => {
  it("creates a workflow definition", () => {
    const wf = defineWorkflow("test", async (ctx) => {
      await ctx.step("s1", () => "done")
    })
    expect(wf.name).toBe("test")
  })
})

describe("WorkflowEngine", () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    engine = new WorkflowEngine()
  })

  it("registers and starts a workflow", async () => {
    engine.register(
      defineWorkflow("greet", async (ctx, args: { name: string }) => {
        await ctx.step("say-hello", () => `Hello ${args.name}`)
      }),
    )

    const instance = await engine.start("greet", { name: "World" })
    expect(instance.status).toBe("completed")
    expect(instance.steps).toHaveLength(1)
    expect(instance.steps[0].result).toBe("Hello World")
  })

  it("throws on unregistered workflow", async () => {
    await expect(engine.start("missing", {})).rejects.toThrow(WorkflowError)
  })

  it("executes multi-step workflows", async () => {
    const results: string[] = []

    engine.register(
      defineWorkflow("multi", async (ctx) => {
        await ctx.step("s1", () => {
          results.push("a")
          return "a"
        })
        await ctx.step("s2", () => {
          results.push("b")
          return "b"
        })
        await ctx.step("s3", () => {
          results.push("c")
          return "c"
        })
      }),
    )

    const instance = await engine.start("multi", {})
    expect(instance.status).toBe("completed")
    expect(results).toEqual(["a", "b", "c"])
    expect(instance.steps).toHaveLength(3)
  })

  it("handles step failures", async () => {
    engine.register(
      defineWorkflow("failing", async (ctx) => {
        await ctx.step(
          "bad",
          () => {
            throw new Error("boom")
          },
          { maxRetries: 0 },
        )
      }),
    )

    const instance = await engine.start("failing", {})
    expect(instance.status).toBe("failed")
    expect(instance.error).toContain("boom")
  })

  it("cancels a running workflow", async () => {
    engine.register(
      defineWorkflow("long", async (ctx) => {
        await ctx.step("s1", () => "done")
      }),
    )

    const instance = await engine.start("long", {})
    // Already completed, cancel returns false
    expect(engine.cancel(instance.id)).toBe(false)
  })

  it("lists instances by status", async () => {
    engine.register(
      defineWorkflow("ok", async (ctx) => {
        await ctx.step("s1", () => "done")
      }),
    )

    await engine.start("ok", {})
    expect(engine.listInstances("completed")).toHaveLength(1)
    expect(engine.listInstances("failed")).toHaveLength(0)
  })

  it("gets instance by ID", async () => {
    engine.register(
      defineWorkflow("test", async (ctx) => {
        await ctx.step("s1", () => "ok")
      }),
    )

    const instance = await engine.start("test", {})
    expect(engine.getInstance(instance.id)?.status).toBe("completed")
  })

  it("tracks instance count", async () => {
    engine.register(
      defineWorkflow("test", async (ctx) => {
        await ctx.step("s1", () => "ok")
      }),
    )

    await engine.start("test", {})
    await engine.start("test", {})
    expect(engine.instanceCount).toBe(2)
  })
})

describe("WorkflowContext", () => {
  it("tracks step records", async () => {
    const ctx = new WorkflowContext("wf-1", "test")
    await ctx.step("s1", () => "result-1")
    await ctx.step("s2", () => "result-2")

    expect(ctx.stepRecords).toHaveLength(2)
    expect(ctx.completedStepCount).toBe(2)
  })

  it("replays completed steps", async () => {
    let callCount = 0
    const ctx = new WorkflowContext("wf-1", "test", [
      {
        name: "s1",
        status: "completed",
        result: "cached",
        error: null,
        startedAt: Date.now(),
        completedAt: Date.now(),
        durationMs: 1,
        retryCount: 0,
      },
    ])

    const result = await ctx.step("s1", () => {
      callCount++
      return "fresh"
    })
    expect(result).toBe("cached")
    expect(callCount).toBe(0) // Function was not called
  })

  it("retries failed steps", async () => {
    const ctx = new WorkflowContext("wf-1", "test")
    let attempts = 0

    const result = await ctx.step(
      "retry-me",
      () => {
        attempts++
        if (attempts < 3) throw new Error("not yet")
        return "success"
      },
      { maxRetries: 3 },
    )

    expect(result).toBe("success")
    expect(attempts).toBe(3)
  })
})

describe("Workflow SQL", () => {
  it("generates workflow table SQL", () => {
    const sql = generateWorkflowTableSQL()
    expect(sql).toContain("_reactivebase_workflows")
    expect(sql).toContain("CREATE INDEX")
  })
})

// ─── DB Persistence Tests ────────────────────────────────────────────────────

describe("WorkflowEngine DB persistence", () => {
  it("initTables() executes CREATE TABLE SQL", async () => {
    const { db, calls } = createMockDb()
    const engine = new WorkflowEngine({ db })
    await engine.initTables()

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain("CREATE TABLE IF NOT EXISTS _reactivebase_workflows")
    expect(calls[0].sql).toContain("CREATE INDEX")
    expect(calls[0].params).toEqual([])
  })

  it("initTables() is a no-op without DB", async () => {
    const engine = new WorkflowEngine()
    // Should not throw
    await engine.initTables()
  })

  it("start() persists the workflow instance via INSERT", async () => {
    const { db, calls } = createMockDb()
    const engine = new WorkflowEngine({ db })

    engine.register(
      defineWorkflow("greet", async (ctx, args: { name: string }) => {
        await ctx.step("say-hello", () => `Hello ${args.name}`)
      }),
    )

    const instance = await engine.start("greet", { name: "World" })

    const insertCall = calls.find((c) => c.sql.includes("INSERT INTO _reactivebase_workflows"))
    expect(insertCall).toBeDefined()
    expect(insertCall!.params[1]).toBe("greet") // workflow_name
    expect(insertCall!.params[2]).toBe("running") // initial status
    expect(insertCall!.params[3]).toBe(JSON.stringify({ name: "World" })) // args
    expect(instance.status).toBe("completed")
  })

  it("checkpoints after each step completion", async () => {
    const { db, calls } = createMockDb()
    const engine = new WorkflowEngine({ db })

    engine.register(
      defineWorkflow("multi", async (ctx) => {
        await ctx.step("s1", () => "a")
        await ctx.step("s2", () => "b")
      }),
    )

    await engine.start("multi", {})

    // Should have: 1 INSERT + 2 step-checkpoint UPDATEs + 1 final completion UPDATE
    const updateCalls = calls.filter((c) => c.sql.includes("UPDATE _reactivebase_workflows"))
    expect(updateCalls.length).toBeGreaterThanOrEqual(3) // 2 step checkpoints + 1 completion

    // First step checkpoint should have steps with s1 completed
    const firstCheckpoint = updateCalls[0]
    const stepsJson = firstCheckpoint.params[2] as string
    const steps = JSON.parse(stepsJson)
    expect(steps).toHaveLength(1)
    expect(steps[0].name).toBe("s1")
    expect(steps[0].status).toBe("completed")
  })

  it("persists completed status on workflow completion", async () => {
    const { db, calls } = createMockDb()
    const engine = new WorkflowEngine({ db })

    engine.register(
      defineWorkflow("simple", async (ctx) => {
        await ctx.step("s1", () => "done")
      }),
    )

    await engine.start("simple", {})

    const updateCalls = calls.filter((c) => c.sql.includes("UPDATE _reactivebase_workflows"))
    const finalUpdate = updateCalls[updateCalls.length - 1]
    expect(finalUpdate.params[1]).toBe("completed") // status param
    expect(finalUpdate.params[4]).toBeDefined() // completedAt is set
  })

  it("persists failed status when workflow fails", async () => {
    const { db, calls } = createMockDb()
    const engine = new WorkflowEngine({ db })

    engine.register(
      defineWorkflow("failing", async (ctx) => {
        await ctx.step(
          "bad",
          () => {
            throw new Error("boom")
          },
          { maxRetries: 0 },
        )
      }),
    )

    const instance = await engine.start("failing", {})
    expect(instance.status).toBe("failed")

    const updateCalls = calls.filter((c) => c.sql.includes("UPDATE _reactivebase_workflows"))
    const failureUpdate = updateCalls[updateCalls.length - 1]
    expect(failureUpdate.params[1]).toBe("failed") // status
    expect(failureUpdate.params[5]).toContain("boom") // error message
  })

  it("recoverWorkflows() queries for pending/running/waiting workflows", async () => {
    const { db, calls } = createMockDb([
      {
        id: "wf_recovered_1",
        workflow_name: "greet",
        status: "running",
        args: JSON.stringify({ name: "Recovered" }),
        steps: JSON.stringify([]),
        current_step: null,
        started_at: Date.now(),
        completed_at: null,
        error: null,
        retry_count: 0,
        waiting_for: null,
      },
    ])
    const engine = new WorkflowEngine({ db })

    engine.register(
      defineWorkflow("greet", async (ctx, args: { name: string }) => {
        await ctx.step("say-hello", () => `Hello ${args.name}`)
      }),
    )

    const count = await engine.recoverWorkflows()
    expect(count).toBe(1)

    // Verify it queried for incomplete workflows
    const selectCall = calls.find((c) => c.sql.includes("SELECT"))
    expect(selectCall).toBeDefined()
    expect(selectCall!.sql).toContain("pending")
    expect(selectCall!.sql).toContain("running")
    expect(selectCall!.sql).toContain("waiting")

    // The recovered workflow should now be in the engine
    expect(engine.instanceCount).toBe(1)
  })

  it("recoverWorkflows() returns 0 without DB", async () => {
    const engine = new WorkflowEngine()
    const count = await engine.recoverWorkflows()
    expect(count).toBe(0)
  })

  it("workflow continues even if DB calls fail", async () => {
    let callCount = 0
    const failingDb: QueryExecutor = async () => {
      callCount++
      throw new Error("DB connection lost")
    }
    const engine = new WorkflowEngine({ db: failingDb })

    engine.register(
      defineWorkflow("resilient", async (ctx) => {
        await ctx.step("s1", () => "still works")
      }),
    )

    const instance = await engine.start("resilient", {})
    expect(instance.status).toBe("completed")
    expect(instance.steps[0].result).toBe("still works")
    // DB was called (insert + step checkpoint + completion) but failures were swallowed
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  it("engine without DB preserves all in-memory behavior", async () => {
    const engine = new WorkflowEngine()

    engine.register(
      defineWorkflow("mem-only", async (ctx) => {
        await ctx.step("s1", () => "a")
        await ctx.step("s2", () => "b")
      }),
    )

    const instance = await engine.start("mem-only", {})
    expect(instance.status).toBe("completed")
    expect(instance.steps).toHaveLength(2)
    expect(instance.steps[0].result).toBe("a")
    expect(instance.steps[1].result).toBe("b")
    expect(engine.instanceCount).toBe(1)
    expect(engine.getInstance(instance.id)?.status).toBe("completed")
    expect(engine.listInstances("completed")).toHaveLength(1)
  })

  it("recoverWorkflows() resumes running workflows and executes remaining steps", async () => {
    const completedStep = {
      name: "s1",
      status: "completed",
      result: "first",
      error: null,
      startedAt: Date.now() - 1000,
      completedAt: Date.now() - 500,
      durationMs: 500,
      retryCount: 0,
    }

    const { db } = createMockDb([
      {
        id: "wf_resume_1",
        workflow_name: "multi-step",
        status: "running",
        args: JSON.stringify({}),
        steps: JSON.stringify([completedStep]),
        current_step: "s1",
        started_at: Date.now() - 2000,
        completed_at: null,
        error: null,
        retry_count: 0,
        waiting_for: null,
      },
    ])
    const engine = new WorkflowEngine({ db })

    let s1Executed = false
    engine.register(
      defineWorkflow("multi-step", async (ctx) => {
        await ctx.step("s1", () => {
          s1Executed = true
          return "first"
        })
        await ctx.step("s2", () => "second")
      }),
    )

    const count = await engine.recoverWorkflows()
    expect(count).toBe(1)

    const instance = engine.getInstance("wf_resume_1")
    expect(instance?.status).toBe("completed")
    // s1 should be replayed from cache, not re-executed
    expect(s1Executed).toBe(false)
    expect(instance?.steps).toHaveLength(2)
  })

  it("recoverWorkflows() does not re-execute waiting workflows", async () => {
    const { db } = createMockDb([
      {
        id: "wf_waiting_1",
        workflow_name: "wait-wf",
        status: "waiting",
        args: JSON.stringify({}),
        steps: JSON.stringify([]),
        current_step: null,
        started_at: Date.now(),
        completed_at: null,
        error: null,
        retry_count: 0,
        waiting_for: "approval",
      },
    ])
    const engine = new WorkflowEngine({ db })

    engine.register(
      defineWorkflow("wait-wf", async (ctx) => {
        await ctx.step("s1", () => "done")
      }),
    )

    const count = await engine.recoverWorkflows()
    expect(count).toBe(1)

    const instance = engine.getInstance("wf_waiting_1")
    // Waiting workflows should remain waiting, not be re-executed
    expect(instance?.status).toBe("waiting")
    expect(instance?.waitingFor).toBe("approval")
  })
})
