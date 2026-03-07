/**
 * Graceful Shutdown Coordinator for ReactiveBase.
 *
 * Orchestrates ordered shutdown when the process receives SIGTERM/SIGINT:
 *   1. Stop accepting new connections
 *   2. Drain active WebSocket connections (send shutdown notice)
 *   3. Cancel in-flight subscriptions
 *   4. Flush transactional outbox
 *   5. Close database pools
 *   6. Exit cleanly
 *
 * Configurable timeout ensures the process exits even if draining hangs.
 */

import { ShutdownError } from "../errors.js"

export type ShutdownPhase =
  | "running"
  | "draining"
  | "closing-subscriptions"
  | "flushing-outbox"
  | "closing-pools"
  | "stopped"

export interface ShutdownHook {
  readonly name: string
  readonly phase: ShutdownPhase
  execute(): Promise<void>
}

export interface ShutdownCoordinatorOptions {
  /** Maximum time in ms to wait for graceful shutdown before forcing exit. Default: 10000. */
  timeoutMs?: number
  /** Logger function. Default: console.log */
  logger?: (message: string) => void
}

const PHASE_ORDER: ShutdownPhase[] = [
  "draining",
  "closing-subscriptions",
  "flushing-outbox",
  "closing-pools",
  "stopped",
]

export class ShutdownCoordinator {
  private hooks: ShutdownHook[] = []
  private currentPhase: ShutdownPhase = "running"
  private shutdownPromise: Promise<void> | null = null
  private timeoutMs: number
  private logger: (message: string) => void
  private signalHandlersInstalled = false

  constructor(options: ShutdownCoordinatorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000
    // eslint-disable-next-line no-console
    this.logger = options.logger ?? console.log
  }

  /**
   * Register a shutdown hook that runs during a specific phase.
   */
  addHook(hook: ShutdownHook): void {
    this.hooks.push(hook)
  }

  /**
   * Register convenience hooks from server components.
   */
  registerDefaults(components: {
    stopAccepting?: () => Promise<void>
    drainConnections?: () => Promise<void>
    cancelSubscriptions?: () => Promise<void>
    flushOutbox?: () => Promise<void>
    closePools?: () => Promise<void>
  }): void {
    if (components.stopAccepting) {
      this.addHook({ name: "stop-accepting", phase: "draining", execute: components.stopAccepting })
    }
    if (components.drainConnections) {
      this.addHook({ name: "drain-connections", phase: "draining", execute: components.drainConnections })
    }
    if (components.cancelSubscriptions) {
      this.addHook({
        name: "cancel-subscriptions",
        phase: "closing-subscriptions",
        execute: components.cancelSubscriptions,
      })
    }
    if (components.flushOutbox) {
      this.addHook({ name: "flush-outbox", phase: "flushing-outbox", execute: components.flushOutbox })
    }
    if (components.closePools) {
      this.addHook({ name: "close-pools", phase: "closing-pools", execute: components.closePools })
    }
  }

  /**
   * Install SIGTERM and SIGINT handlers.
   * Safe to call multiple times (handlers are installed once).
   */
  installSignalHandlers(): void {
    if (this.signalHandlersInstalled) return
    this.signalHandlersInstalled = true

    const handler = () => {
      this.shutdown().catch((err) => {
        this.logger(`Shutdown error: ${err}`)
        process.exit(1)
      })
    }

    process.on("SIGTERM", handler)
    process.on("SIGINT", handler)
  }

  /**
   * Whether the server is currently shutting down.
   */
  get isShuttingDown(): boolean {
    return this.currentPhase !== "running"
  }

  /**
   * Current shutdown phase.
   */
  get phase(): ShutdownPhase {
    return this.currentPhase
  }

  /**
   * Throws a ShutdownError if the server is shutting down.
   * Use as a guard at request entry points.
   */
  ensureRunning(): void {
    if (this.isShuttingDown) {
      throw new ShutdownError()
    }
  }

  /**
   * Initiate graceful shutdown. Idempotent — calling multiple times
   * returns the same shutdown promise.
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise

    this.shutdownPromise = this.executeShutdown()
    return this.shutdownPromise
  }

  private async executeShutdown(): Promise<void> {
    this.logger("Graceful shutdown initiated...")

    // Race against timeout
    const timeoutPromise = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), this.timeoutMs))

    const shutdownWork = (async () => {
      for (const phase of PHASE_ORDER) {
        this.currentPhase = phase
        const phaseHooks = this.hooks.filter((h) => h.phase === phase)

        if (phaseHooks.length > 0) {
          this.logger(`  Phase: ${phase} (${phaseHooks.length} hooks)`)
        }

        // Run hooks within the same phase concurrently
        await Promise.all(
          phaseHooks.map(async (hook) => {
            try {
              await hook.execute()
              this.logger(`    ✓ ${hook.name}`)
            } catch (err) {
              this.logger(`    ✗ ${hook.name}: ${err}`)
            }
          }),
        )
      }
      return "done" as const
    })()

    const result = await Promise.race([shutdownWork, timeoutPromise])

    if (result === "timeout") {
      this.logger(`Shutdown timed out after ${this.timeoutMs}ms — forcing exit`)
      this.currentPhase = "stopped"
    } else {
      this.logger("Graceful shutdown complete")
    }
  }
}

/**
 * Create a shutdown coordinator with default settings.
 */
export function createShutdownCoordinator(options?: ShutdownCoordinatorOptions): ShutdownCoordinator {
  return new ShutdownCoordinator(options)
}
