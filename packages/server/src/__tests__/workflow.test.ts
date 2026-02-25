import { describe, it, expect, beforeEach } from "vitest"
import {
  WorkflowEngine,
  WorkflowContext,
  defineWorkflow,
  WorkflowError,
  _WorkflowStepError,
  generateWorkflowTableSQL,
} from "../workflow/workflow.js"

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
