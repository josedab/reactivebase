/**
 * Circuit Breaker for webhook delivery.
 * Prevents cascading failures by temporarily disabling delivery to
 * endpoints that are consistently failing.
 *
 * States:
 *   - CLOSED: Normal operation, requests pass through
 *   - OPEN: Failing, requests are immediately rejected
 *   - HALF_OPEN: Testing recovery, limited requests pass through
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half_open"

export interface CircuitBreakerOptions {
  /** Failure threshold before opening circuit (default: 5) */
  failureThreshold?: number
  /** Time in ms before attempting recovery (default: 30000) */
  resetTimeoutMs?: number
  /** Number of test requests in half-open state (default: 2) */
  halfOpenRequests?: number
  /** Sliding window size for failure counting (default: 10) */
  windowSize?: number
  /** Callback when state changes */
  onStateChange?: (endpoint: string, from: CircuitState, to: CircuitState) => void
}

export interface CircuitBreakerStats {
  endpoint: string
  state: CircuitState
  failures: number
  successes: number
  totalRequests: number
  lastFailureAt: number | null
  lastSuccessAt: number | null
  openedAt: number | null
  halfOpenAttempts: number
}

// ─── Implementation ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<CircuitBreakerOptions, "onStateChange">> = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenRequests: 2,
  windowSize: 10,
}

interface EndpointCircuit {
  state: CircuitState
  failures: number
  successes: number
  totalRequests: number
  recentResults: boolean[]
  lastFailureAt: number | null
  lastSuccessAt: number | null
  openedAt: number | null
  halfOpenAttempts: number
}

export class CircuitBreakerRegistry {
  private circuits = new Map<string, EndpointCircuit>()
  private options: Required<Omit<CircuitBreakerOptions, "onStateChange">>
  private onStateChange?: CircuitBreakerOptions["onStateChange"]

  constructor(options: CircuitBreakerOptions = {}) {
    const { onStateChange, ...rest } = options
    this.options = { ...DEFAULT_OPTIONS, ...rest }
    this.onStateChange = onStateChange
  }

  /**
   * Check if a request to the endpoint is allowed.
   */
  canExecute(endpoint: string): boolean {
    const circuit = this.getOrCreate(endpoint)

    switch (circuit.state) {
      case "closed":
        return true
      case "open": {
        if (Date.now() - (circuit.openedAt ?? 0) >= this.options.resetTimeoutMs) {
          this.transition(endpoint, circuit, "half_open")
          circuit.halfOpenAttempts = 0
          return true
        }
        return false
      }
      case "half_open":
        return circuit.halfOpenAttempts < this.options.halfOpenRequests
    }
  }

  /**
   * Record a successful request.
   */
  recordSuccess(endpoint: string): void {
    const circuit = this.getOrCreate(endpoint)
    circuit.successes++
    circuit.totalRequests++
    circuit.lastSuccessAt = Date.now()
    circuit.recentResults.push(true)
    if (circuit.recentResults.length > this.options.windowSize) {
      circuit.recentResults.shift()
    }

    if (circuit.state === "half_open") {
      circuit.halfOpenAttempts++
      if (circuit.halfOpenAttempts >= this.options.halfOpenRequests) {
        this.transition(endpoint, circuit, "closed")
        circuit.failures = 0
        circuit.recentResults = []
      }
    }
  }

  /**
   * Record a failed request.
   */
  recordFailure(endpoint: string): void {
    const circuit = this.getOrCreate(endpoint)
    circuit.failures++
    circuit.totalRequests++
    circuit.lastFailureAt = Date.now()
    circuit.recentResults.push(false)
    if (circuit.recentResults.length > this.options.windowSize) {
      circuit.recentResults.shift()
    }

    if (circuit.state === "half_open") {
      this.transition(endpoint, circuit, "open")
      circuit.openedAt = Date.now()
      return
    }

    const recentFailures = circuit.recentResults.filter((r) => !r).length
    if (circuit.state === "closed" && recentFailures >= this.options.failureThreshold) {
      this.transition(endpoint, circuit, "open")
      circuit.openedAt = Date.now()
    }
  }

  /**
   * Get stats for an endpoint.
   */
  getStats(endpoint: string): CircuitBreakerStats {
    const circuit = this.getOrCreate(endpoint)
    return {
      endpoint,
      state: circuit.state,
      failures: circuit.failures,
      successes: circuit.successes,
      totalRequests: circuit.totalRequests,
      lastFailureAt: circuit.lastFailureAt,
      lastSuccessAt: circuit.lastSuccessAt,
      openedAt: circuit.openedAt,
      halfOpenAttempts: circuit.halfOpenAttempts,
    }
  }

  /**
   * Get stats for all tracked endpoints.
   */
  getAllStats(): CircuitBreakerStats[] {
    return Array.from(this.circuits.keys()).map((endpoint) => this.getStats(endpoint))
  }

  /**
   * Force-reset a circuit to closed state.
   */
  reset(endpoint: string): void {
    this.circuits.delete(endpoint)
  }

  /**
   * Reset all circuits.
   */
  resetAll(): void {
    this.circuits.clear()
  }

  private getOrCreate(endpoint: string): EndpointCircuit {
    let circuit = this.circuits.get(endpoint)
    if (!circuit) {
      circuit = {
        state: "closed",
        failures: 0,
        successes: 0,
        totalRequests: 0,
        recentResults: [],
        lastFailureAt: null,
        lastSuccessAt: null,
        openedAt: null,
        halfOpenAttempts: 0,
      }
      this.circuits.set(endpoint, circuit)
    }
    return circuit
  }

  private transition(endpoint: string, circuit: EndpointCircuit, newState: CircuitState): void {
    const oldState = circuit.state
    circuit.state = newState
    this.onStateChange?.(endpoint, oldState, newState)
  }
}

/**
 * Wrap an async function with circuit breaker protection.
 */
export async function withCircuitBreaker<T>(
  registry: CircuitBreakerRegistry,
  endpoint: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!registry.canExecute(endpoint)) {
    throw new CircuitOpenError(endpoint)
  }

  try {
    const result = await fn()
    registry.recordSuccess(endpoint)
    return result
  } catch (error: unknown) {
    registry.recordFailure(endpoint)
    throw error
  }
}

export class CircuitOpenError extends Error {
  readonly code = "CIRCUIT_OPEN"

  constructor(public readonly endpoint: string) {
    super(`Circuit breaker is open for endpoint: ${endpoint}`)
    this.name = "CircuitOpenError"
  }
}
