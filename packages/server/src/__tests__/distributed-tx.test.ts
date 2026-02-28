import { describe, it, expect, vi } from "vitest"
import {
  TwoPhaseCommitCoordinator,
  SagaOrchestrator,
  DeadLetterQueue,
  DistributedTracer,
} from "../distributed-tx/distributed-tx.js"
import type { ParticipantAdapter, SagaStep } from "../distributed-tx/distributed-tx.js"

describe("TwoPhaseCommitCoordinator", () => {
  function createMockAdapter(): ParticipantAdapter {
    return {
      prepare: vi.fn().mockResolvedValue({ participantId: "", success: true }),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    }
  }

  it("commits a distributed transaction when all participants prepare successfully", async () => {
    const adapter = createMockAdapter()
    ;(adapter.prepare as ReturnType<typeof vi.fn>).mockImplementation(
      async (pid: string) => ({ participantId: pid, success: true }),
    )

    const coordinator = new TwoPhaseCommitCoordinator(adapter)
    coordinator.registerParticipant({ id: "db1", connectionString: "pg://db1", name: "Primary" })
    coordinator.registerParticipant({ id: "db2", connectionString: "pg://db2", name: "Secondary" })

    const operations = new Map<string, unknown[]>()
    operations.set("db1", [{ sql: "INSERT INTO users..." }])
    operations.set("db2", [{ sql: "INSERT INTO audit_log..." }])

    const result = await coordinator.executeTransaction(["db1", "db2"], operations)

    expect(result.status).toBe("committed")
    expect(adapter.prepare).toHaveBeenCalledTimes(2)
    expect(adapter.commit).toHaveBeenCalledTimes(2)
  })

  it("aborts when a participant fails to prepare", async () => {
    const adapter = createMockAdapter()
    ;(adapter.prepare as ReturnType<typeof vi.fn>).mockImplementation(
      async (pid: string) => ({ participantId: pid, success: pid !== "db2" }),
    )

    const coordinator = new TwoPhaseCommitCoordinator(adapter)
    coordinator.registerParticipant({ id: "db1", connectionString: "pg://db1", name: "Primary" })
    coordinator.registerParticipant({ id: "db2", connectionString: "pg://db2", name: "Secondary" })

    const result = await coordinator.executeTransaction(["db1", "db2"], new Map())

    expect(result.status).toBe("aborted")
    expect(adapter.rollback).toHaveBeenCalled()
    expect(adapter.commit).not.toHaveBeenCalled()
  })

  it("throws on unknown participant", async () => {
    const adapter = createMockAdapter()
    const coordinator = new TwoPhaseCommitCoordinator(adapter)

    await expect(
      coordinator.executeTransaction(["unknown"], new Map()),
    ).rejects.toThrow('Unknown participant: "unknown"')
  })

  it("adds to dead letter queue on failure", async () => {
    const adapter = createMockAdapter()
    ;(adapter.prepare as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Connection lost"))

    const coordinator = new TwoPhaseCommitCoordinator(adapter, { deadLetterEnabled: true })
    coordinator.registerParticipant({ id: "db1", connectionString: "pg://db1", name: "Primary" })

    const result = await coordinator.executeTransaction(["db1"], new Map())

    expect(result.status).toBe("failed")
    expect(coordinator.getDeadLetterQueue().size).toBe(1)
  })
})

describe("SagaOrchestrator", () => {
  it("executes all steps in order", async () => {
    const executionOrder: string[] = []

    const saga = new SagaOrchestrator<{ count: number }>()
    saga.addStep({
      name: "step1",
      execute: async (ctx) => {
        executionOrder.push("step1")
        return { count: ctx.count + 1 }
      },
      compensate: async (ctx) => ctx,
    })
    saga.addStep({
      name: "step2",
      execute: async (ctx) => {
        executionOrder.push("step2")
        return { count: ctx.count + 10 }
      },
      compensate: async (ctx) => ctx,
    })

    const result = await saga.execute({ count: 0 })

    expect(result.success).toBe(true)
    expect(result.context.count).toBe(11)
    expect(executionOrder).toEqual(["step1", "step2"])
    expect(result.steps.every((s) => s.status === "completed")).toBe(true)
  })

  it("compensates completed steps on failure in reverse order", async () => {
    const compensationOrder: string[] = []

    const saga = new SagaOrchestrator<{ log: string[] }>()
    saga.addStep({
      name: "createUser",
      execute: async (ctx) => ({ log: [...ctx.log, "user_created"] }),
      compensate: async (ctx) => {
        compensationOrder.push("createUser")
        return { log: [...ctx.log, "user_deleted"] }
      },
    })
    saga.addStep({
      name: "createOrder",
      execute: async (ctx) => ({ log: [...ctx.log, "order_created"] }),
      compensate: async (ctx) => {
        compensationOrder.push("createOrder")
        return { log: [...ctx.log, "order_cancelled"] }
      },
    })
    saga.addStep({
      name: "chargePayment",
      execute: async () => {
        throw new Error("Payment gateway down")
      },
      compensate: async (ctx) => ctx,
    })

    const result = await saga.execute({ log: [] })

    expect(result.success).toBe(false)
    expect(compensationOrder).toEqual(["createOrder", "createUser"])
    expect(result.steps[2].status).toBe("failed")
    expect(result.steps[1].status).toBe("compensated")
    expect(result.steps[0].status).toBe("compensated")
  })
})

describe("DeadLetterQueue", () => {
  it("manages entries", () => {
    const dlq = new DeadLetterQueue()

    dlq.add({
      transactionId: "tx1",
      error: "timeout",
      participantStates: new Map([["db1", "failed"]]),
      timestamp: new Date(),
      retryCount: 0,
    })

    expect(dlq.size).toBe(1)
    expect(dlq.get("tx1")?.error).toBe("timeout")
    expect(dlq.getAll()).toHaveLength(1)

    dlq.remove("tx1")
    expect(dlq.size).toBe(0)
  })
})

describe("DistributedTracer", () => {
  it("tracks spans and events", () => {
    const tracer = new DistributedTracer()
    const span = tracer.startSpan("trace1", "2pc:prepare")

    tracer.addEvent(span.spanId, "participant_prepared", { participant: "db1" })
    const completed = tracer.endSpan(span.spanId)

    expect(completed).toBeDefined()
    expect(completed!.endTime).toBeDefined()
    expect(completed!.events).toHaveLength(1)
    expect(tracer.getCompletedSpans("trace1")).toHaveLength(1)
  })
})
