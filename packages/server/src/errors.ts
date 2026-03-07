/**
 * Structured error hierarchy for ReactiveBase.
 * All domain errors extend ReactiveBaseError with consistent codes,
 * HTTP status mappings, and a serialization format for the client SDK.
 */

// ── Error Registry: maps error codes to HTTP status codes ────────────────────

export const ERROR_HTTP_STATUS: Record<string, number> = {
  READ_ONLY_VIOLATION: 400,
  RECORD_NOT_FOUND: 404,
  FUNCTION_NOT_FOUND: 404,
  NOT_QUERY_FUNCTION: 400,
  CIRCULAR_DEPENDENCY: 400,
  EMIT_OUTSIDE_MUTATION: 400,
  QUERY_CONTEXT_REQUIRED: 400,
  INVALID_MESSAGE: 400,
  SCHEMA_VALIDATION_ERROR: 400,
  VALIDATION_ERROR: 400,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  RATE_LIMIT_EXCEEDED: 429,
  CONFIG_VALIDATION_ERROR: 500,
  PAGINATION_ERROR: 400,
  SHUTDOWN_IN_PROGRESS: 503,
  INTERNAL_ERROR: 500,
  CLOUD_PLATFORM_ERROR: 400,
  CLOUD_PLATFORM_NOT_FOUND: 404,
  CLOUD_PLATFORM_LIMIT: 429,
  CLOUD_PLATFORM_CONFLICT: 409,
}

// ── Serialization format ─────────────────────────────────────────────────────

export interface SerializedError {
  code: string
  message: string
  httpStatus: number
  details?: Record<string, unknown>
}

// ── Base class ───────────────────────────────────────────────────────────────

export class ReactiveBaseError extends Error {
  /** HTTP status code for this error type */
  readonly httpStatus: number
  /** Optional structured details (e.g., field-level validation errors) */
  readonly details?: Record<string, unknown>

  constructor(
    message: string,
    public readonly code: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "ReactiveBaseError"
    this.httpStatus = ERROR_HTTP_STATUS[code] ?? 500
    this.details = details
  }

  /**
   * Serialize this error into a JSON-safe object suitable for wire transport.
   */
  serialize(): SerializedError {
    return {
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

/**
 * Deserialize a wire-format error back into a ReactiveBaseError.
 */
export function deserializeError(data: SerializedError): ReactiveBaseError {
  return new ReactiveBaseError(data.message, data.code, data.details)
}

// ── Domain error classes ─────────────────────────────────────────────────────

export class ReadOnlyError extends ReactiveBaseError {
  constructor() {
    super("Cannot perform write operations in a read-only query. Use a mutation instead.", "READ_ONLY_VIOLATION")
    this.name = "ReadOnlyError"
  }
}

export class RecordNotFoundError extends ReactiveBaseError {
  constructor(tableName: string, id: string) {
    super(`Record not found in "${tableName}" with id "${id}"`, "RECORD_NOT_FOUND", { tableName, id })
    this.name = "RecordNotFoundError"
  }
}

export class FunctionNotFoundError extends ReactiveBaseError {
  constructor(name: string) {
    super(`Query function not found: "${name}"`, "FUNCTION_NOT_FOUND", { functionName: name })
    this.name = "FunctionNotFoundError"
  }
}

export class NotQueryFunctionError extends ReactiveBaseError {
  constructor(name: string) {
    super(`"${name}" is not a query function`, "NOT_QUERY_FUNCTION", { functionName: name })
    this.name = "NotQueryFunctionError"
  }
}

export class CircularDependencyError extends ReactiveBaseError {
  constructor(cycle: string) {
    super(`Circular query dependency detected: ${cycle}`, "CIRCULAR_DEPENDENCY", { cycle })
    this.name = "CircularDependencyError"
  }
}

export class EmitOutsideMutationError extends ReactiveBaseError {
  constructor() {
    super("ctx.emit() is only available inside mutation handlers", "EMIT_OUTSIDE_MUTATION")
    this.name = "EmitOutsideMutationError"
  }
}

export class QueryContextRequiredError extends ReactiveBaseError {
  constructor() {
    super("ctx.query() requires a query resolution context", "QUERY_CONTEXT_REQUIRED")
    this.name = "QueryContextRequiredError"
  }
}

export class InvalidMessageError extends ReactiveBaseError {
  constructor(detail: string) {
    super(`Invalid message: ${detail}`, "INVALID_MESSAGE", { detail })
    this.name = "InvalidMessageError"
  }
}

export class SchemaValidationError extends ReactiveBaseError {
  constructor(message: string) {
    super(message, "SCHEMA_VALIDATION_ERROR")
    this.name = "SchemaValidationError"
  }
}

export class PaginationError extends ReactiveBaseError {
  constructor(message: string) {
    super(message, "PAGINATION_ERROR")
    this.name = "PaginationError"
  }
}

export class ShutdownError extends ReactiveBaseError {
  constructor() {
    super("Server is shutting down — try again later", "SHUTDOWN_IN_PROGRESS")
    this.name = "ShutdownError"
  }
}

export class CloudPlatformError extends ReactiveBaseError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CLOUD_PLATFORM_ERROR", details)
    this.name = "CloudPlatformError"
  }
}

export class CloudPlatformNotFoundError extends ReactiveBaseError {
  constructor(resourceType: string, resourceId: string) {
    super(`${resourceType} ${resourceId} not found`, "CLOUD_PLATFORM_NOT_FOUND", { resourceType, resourceId })
    this.name = "CloudPlatformNotFoundError"
  }
}

export class CloudPlatformLimitError extends ReactiveBaseError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CLOUD_PLATFORM_LIMIT", details)
    this.name = "CloudPlatformLimitError"
  }
}

export class CloudPlatformConflictError extends ReactiveBaseError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CLOUD_PLATFORM_CONFLICT", details)
    this.name = "CloudPlatformConflictError"
  }
}
