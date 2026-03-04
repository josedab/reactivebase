/**
 * Extended tests for distributed transaction coordinator —
 * 2PC edge cases, saga compensation, timeout handling,
 * partial failures, dead letter queue retry, and tracing.
 */

import { describe, it, expect, vi } from "vitest"
import {
  TwoPhaseCommitCoordinator,
  SagaOrchestrator,
  DeadLetterQueue,
  DistributedTracer,
} from "../distributed-tx/distributed-tx.js"
import type { ParticipantAdapter } from "../distributed-tx/distributed-tx.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockAdapter(overrides?: Partial<ParticipantAdapter>): ParticipantAdapter {
  return {
    prepare: vi.fn(async (pid: string) => ({ participantId: pid, success: true })),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    ...overrides,
  }
}

function setupCoordinator(adapter: ParticipantAdapter, options = {}) {
  const coordinator = new TwoPhaseCommitCoordinator(adapter, options)
  coordinator.registerParticipant({ id: "db1", connectionString: "pg://db1", name: "Primary" })
  coordinator.registerParticipant({ id: "db2", connectionString: "pg://db2", name: "Secondary" })
  return coordinator
}

// ─── TwoPhaseCommitCoordinator — extended ────────────────────────────────────

describe("TwoPhaseCommitCoordinator — extended", () => {
  it("passes correct operations to each participant during prepare", async () => {
    const adapter = createMockAdapter()
    const coordinator = setupCoordinator(adapter)

    const ops = new Map<string, unknown[]>()
    ops.set("db1", [{ sql: "INSERT INTO users..." }])
    ops.set("db2", [{ sql: "INSERT INTO audit..." }])

    await coordinator.executeTransaction(["db1", "db2"], ops)

    expect(adapter.prepare).toHaveBeenCalledWith("db1", expect.any(String), [{ sql: "INSERT INTO users..." }])
    expect(adapter.prepare).toHaveBeenCalledWith("db2", expect.any(String), [{ sql: "INSERT INTO audit..." }])
  })

  it("passes empty ops when participant has no operations", async () => {
    const adapter = createMockAdapter()
    const coordinator = setupCoordinator(adapter)

    await coordinator.executeTransaction(["db1", "db2"], new Map())

    expect(adapter.prepare).toHaveBeenCalledWith("db1", expect.any(String), [])
    expect(adapter.prepare).toHaveBeenCalledWith("db2", expect.any(String), [])
  })

  it("calls rollback for all participants when one fails prepare", async () => {
    const adapter = createMockAdapter({
      prepare: vi.fn(async (pid: string) => ({
        participantId: pid,
        success: pid !== "db2",
      })),
    })
    const coordinator = setupCoordinator(adapter)

    const result = await coordinator.executeTransaction(["db1", "db2"], new Map())

    expect(result.status).toBe("aborted")
    expect(adapter.rollback).toHaveBeenCalledTimes(2)
    expect(adapter.commit).not.toHaveBeenCalled()
  })

  it("records error message for aborted transaction", async () => {
    const adapter = createMockAdapter({
      prepare: vi.fn(async (pid: string) => ({
        participantId: pid,
        success: pid === "db1",
      })),
    })
    const coordinator = setupCoordinator(adapter)

    const result = await coordinator.executeTransaction(["db1", "db2"], new Map())

    const record = coordinator.getTransaction(result.transactionId)
    expect(record?.status).toBe("aborted")
    expect(record?.error).toContain("db2")
  })

  it("handles single participant transaction", async () => {
    const adapter = createMockAdapter()
    const coordinator = setupCoordinator(adapter)

    const result = await coordinator.executeTransaction(["db1"], new Map())

    expect(result.status).toBe("committed")
    expect(adapter.prepare).toHaveBeenCalledTimes(1)
    expect(adapter.commit).toHaveBeenCalledTimes(1)
  })

  it("handles exception during prepare by adding to dead letter queue", async () => {
    const adapter = createMockAdapter({
      prepare: vi.fn(async () => {
        throw new Error("Connection refused")
      }),
    })
    const coordinator = setupCoordinator(adapter, { deadLetterEnabled: true })

    const result = await coordinator.executeTransaction(["db1"], new Map())

    expect(result.status).toBe("failed")
    expect(coordinator.getDeadLetterQueue().size).toBe(1)
  })

  it("does not add to dead letter queue when disabled", async () => {
    const adapter = createMockAdapter({
      prepare: vi.fn(async () => {
        throw new Error("fail")
      }),
    })
    const coordinator = setupCoordinator(adapter, { deadLetterEnabled: false })

    const result = await coordinator.executeTransaction(["db1"], new Map())

    expect(result.status).toBe("failed")
    expect(coordinator.getDeadLetterQueue().size).toBe(0)
  })

  it("handles exception during commit", async () => {
    const adapter = createMockAdapter({
      commit: vi.fn(async () => {
        throw new Error("Commit failed")
      }),
    })
    const coordinator = setupCoordinator(adapter)

    const result = await coordinator.executeTransaction(["db1"], new Map())

    expect(result.status).toBe("failed")
  })

  it("removeParticipant works correctly", async () => {
    const adapter = createMockAdapter()
    const coordinator = new TwoPhaseCommitCoordinator(adapter)
    coordinator.registerParticipant({ id: "p1", connectionString: "pg://p1", name: "P1" })
    coordinator.removeParticipant("p1")

    await expect(coordinator.executeTransaction(["p1"], new Map())).rejects.toThrow("Unknown participant")
  })

  it("getTransaction returns undefined for unknown ID", () => {
    const adapter = createMockAdapter()
    const coordinator = new TwoPhaseCommitCoordinator(adapter)
    expect(coordinator.getTransaction("unknown")).toBeUndefined()
  })
})

// ─── Dead Letter Queue retry ─────────────────────────────────────────────────

describe("TwoPhaseCommitCoordinator — dead letter retry", () => {
  it("retries a failed transaction from dead letter queue", async () => {
    const adapter = createMockAdapter({
      prepare: vi
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValue({ participantId: "db1", success: true }),
    })
    const coordinator = setupCoordinator(adapter, { deadLetterEnabled: true, maxRetries: 3 })

    // First attempt fails
    const result = await coordinator.executeTransaction(["db1"], new Map())
    expect(result.status).toBe("failed")
    expect(coordinator.getDeadLetterQueue().size).toBe(1)

    // Retry succeeds (rollback)
    const retried = await coordinator.retryDeadLetter(result.transactionId)
    expect(retried).toBe(true)
    expect(coordinator.getDeadLetterQueue().size).toBe(0)
  })

  it("rejects retry for unknown transaction", async () => {
    const adapter = createMockAdapter()
    const coordinator = new TwoPhaseCommitCoordinator(adapter)
    const result = await coordinator.retryDeadLetter("unknown")
    expect(result).toBe(false)
  })

  it("rejects retry when max retries exceeded", async () => {
    const adapter = createMockAdapter({
      prepare: vi.fn(async () => {
        throw new Error("fail")
      }),
    })
    const coordinator = setupCoordinator(adapter, { deadLetterEnabled: true, maxRetries: 1 })

    const txResult = await coordinator.executeTransaction(["db1"], new Map())
    // First retry
    await coordinator.retryDeadLetter(txResult.transactionId)
    // Second retry should be rejected (maxRetries=1)
    const retried = await coordinator.retryDeadLetter(txResult.transactionId)
    expect(retried).toBe(false)
  })
})

// ─── SagaOrchestrator — extended ─────────────────────────────────────────────

describe("SagaOrchestrator — extended", () => {
  it("handles empty saga (no steps)", async () => {
    const saga = new SagaOrchestrator<object>()
    const result = await saga.execute({})
    expect(result.success).toBe(true)
    expect(result.steps.length).toBe(0)
  })

  it("first step failure does not trigger compensation", async () => {
    const compensated: string[] = []
    const saga = new SagaOrchestrator<{ log: string[] }>()
    saga.addStep({
      name: "step1",
      execute: async () => {
        throw new Error("Fail immediately")
      },
      compensate: async (ctx) => {
        compensated.push("step1")
        return ctx
      },
    })

    const result = await saga.execute({ log: [] })
    expect(result.success).toBe(false)
    expect(compensated.length).toBe(0) // No compensation for failed step
  })

  it("compensates in reverse order", async () => {
    const order: string[] = []
    const saga = new SagaOrchestrator<{ v: number }>()
    saga.addStep({
      name: "A",
      execute: async (ctx) => ({ v: ctx.v + 1 }),
      compensate: async (ctx) => {
        order.push("A")
        return ctx
      },
    })
    saga.addStep({
      name: "B",
      execute: async (ctx) => ({ v: ctx.v + 10 }),
      compensate: async (ctx) => {
        order.push("B")
        return ctx
      },
    })
    saga.addStep({
      name: "C",
      execute: async () => {
        throw new Error("C failed")
      },
      compensate: async (ctx) => ctx,
    })

    await saga.execute({ v: 0 })
    expect(order).toEqual(["B", "A"])
  })

  it("retries compensation up to maxCompensationRetries", async () => {
    let attempts = 0
    const saga = new SagaOrchestrator<object>({ maxCompensationRetries: 3 })
    saga.addStep({
      name: "step1",
      execute: async (ctx) => ctx,
      compensate: async (ctx) => {
        attempts++
        if (attempts < 3) throw new Error("Compensation failed")
        return ctx
      },
    })
    saga.addStep({
      name: "step2",
      execute: async () => {
        throw new Error("fail")
      },
      compensate: async (ctx) => ctx,
    })

    const result = await saga.execute({})
    expect(attempts).toBe(3)
    expect(result.steps[0].status).toBe("compensated")
  })

  it("marks step as failed when compensation exhausts retries", async () => {
    const saga = new SagaOrchestrator<object>({ maxCompensationRetries: 2 })
    saga.addStep({
      name: "step1",
      execute: async (ctx) => ctx,
      compensate: async () => {
        throw new Error("always fails")
      },
    })
    saga.addStep({
      name: "step2",
      execute: async () => {
        throw new Error("fail")
      },
      compensate: async (ctx) => ctx,
    })

    const result = await saga.execute({})
    expect(result.steps[0].status).toBe("failed")
    expect(result.steps[0].error).toContain("Compensation failed after 2 retries")
  })

  it("calls onStepComplete callback", async () => {
    const onStepComplete = vi.fn()
    const saga = new SagaOrchestrator<{ v: number }>({ onStepComplete })
    saga.addStep({
      name: "step1",
      execute: async (ctx) => ({ v: ctx.v + 1 }),
      compensate: async (ctx) => ctx,
    })

    await saga.execute({ v: 0 })
    expect(onStepComplete).toHaveBeenCalledWith("step1", { v: 1 })
  })

  it("calls onStepFailed callback", async () => {
    const onStepFailed = vi.fn()
    const saga = new SagaOrchestrator<object>({ onStepFailed })
    saga.addStep({
      name: "step1",
      execute: async () => {
        throw new Error("boom")
      },
      compensate: async (ctx) => ctx,
    })

    await saga.execute({})
    expect(onStepFailed).toHaveBeenCalledWith("step1", expect.any(Error))
  })

  it("calls onCompensationComplete callback", async () => {
    const onCompensationComplete = vi.fn()
    const saga = new SagaOrchestrator<object>({ onCompensationComplete })
    saga.addStep({
      name: "step1",
      execute: async (ctx) => ctx,
      compensate: async (ctx) => ctx,
    })
    saga.addStep({
      name: "step2",
      execute: async () => {
        throw new Error("fail")
      },
      compensate: async (ctx) => ctx,
    })

    await saga.execute({})
    expect(onCompensationComplete).toHaveBeenCalledWith("step1")
  })

  it("addStep supports chaining", () => {
    const saga = new SagaOrchestrator<object>()
    const result = saga
      .addStep({ name: "a", execute: async (ctx) => ctx, compensate: async (ctx) => ctx })
      .addStep({ name: "b", execute: async (ctx) => ctx, compensate: async (ctx) => ctx })
    expect(result).toBe(saga)
  })

  it("sets correct timestamps on step records", async () => {
    const saga = new SagaOrchestrator<object>()
    saga.addStep({
      name: "step1",
      execute: async (ctx) => ctx,
      compensate: async (ctx) => ctx,
    })

    const result = await saga.execute({})
    expect(result.steps[0].startedAt).toBeDefined()
    expect(result.steps[0].completedAt).toBeDefined()
    expect(result.completedAt).toBeInstanceOf(Date)
  })
})

// ─── DeadLetterQueue — extended ──────────────────────────────────────────────

describe("DeadLetterQueue — extended", () => {
  it("overwrites entry with same transaction ID", () => {
    const dlq = new DeadLetterQueue()
    dlq.add({
      transactionId: "tx1",
      error: "first",
      participantStates: new Map(),
      timestamp: new Date(),
      retryCount: 0,
    })
    dlq.add({
      transactionId: "tx1",
      error: "second",
      participantStates: new Map(),
      timestamp: new Date(),
      retryCount: 1,
    })
    expect(dlq.size).toBe(1)
    expect(dlq.get("tx1")?.error).toBe("second")
  })

  it("returns undefined for nonexistent entry", () => {
    const dlq = new DeadLetterQueue()
    expect(dlq.get("nonexistent")).toBeUndefined()
  })

  it("remove returns false for nonexistent entry", () => {
    const dlq = new DeadLetterQueue()
    expect(dlq.remove("nonexistent")).toBe(false)
  })

  it("getAll returns all entries", () => {
    const dlq = new DeadLetterQueue()
    dlq.add({ transactionId: "tx1", error: "e1", participantStates: new Map(), timestamp: new Date(), retryCount: 0 })
    dlq.add({ transactionId: "tx2", error: "e2", participantStates: new Map(), timestamp: new Date(), retryCount: 0 })
    expect(dlq.getAll().length).toBe(2)
  })
})

// ─── DistributedTracer — extended ────────────────────────────────────────────

describe("DistributedTracer — extended", () => {
  it("creates span with parent", () => {
    const tracer = new DistributedTracer()
    const parent = tracer.startSpan("t1", "parent-op")
    const child = tracer.startSpan("t1", "child-op", parent.spanId)

    expect(child.parentSpanId).toBe(parent.spanId)
    expect(child.traceId).toBe("t1")
  })

  it("endSpan returns undefined for unknown span", () => {
    const tracer = new DistributedTracer()
    expect(tracer.endSpan("unknown")).toBeUndefined()
  })

  it("addEvent does nothing for unknown span", () => {
    const tracer = new DistributedTracer()
    // Should not throw
    tracer.addEvent("unknown", "event")
  })

  it("multiple events on same span", () => {
    const tracer = new DistributedTracer()
    const span = tracer.startSpan("t1", "op")
    tracer.addEvent(span.spanId, "e1", { key: "v1" })
    tracer.addEvent(span.spanId, "e2", { key: "v2" })
    const completed = tracer.endSpan(span.spanId)
    expect(completed!.events.length).toBe(2)
  })

  it("filters completed spans by traceId", () => {
    const tracer = new DistributedTracer()
    const s1 = tracer.startSpan("t1", "op1")
    const s2 = tracer.startSpan("t2", "op2")
    tracer.endSpan(s1.spanId)
    tracer.endSpan(s2.spanId)

    expect(tracer.getCompletedSpans("t1").length).toBe(1)
    expect(tracer.getCompletedSpans("t2").length).toBe(1)
    expect(tracer.getCompletedSpans().length).toBe(2)
  })

  it("clearCompletedSpans empties the list", () => {
    const tracer = new DistributedTracer()
    const span = tracer.startSpan("t1", "op")
    tracer.endSpan(span.spanId)
    expect(tracer.getCompletedSpans().length).toBe(1)

    tracer.clearCompletedSpans()
    expect(tracer.getCompletedSpans().length).toBe(0)
  })
})
