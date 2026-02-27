/**
 * Structured error base class for ReactiveBase.
 * All domain errors should extend this class to provide consistent error codes.
 */
export class ReactiveBaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = "ReactiveBaseError"
  }
}

export class ReadOnlyError extends ReactiveBaseError {
  constructor() {
    super("Cannot perform write operations in a read-only query. Use a mutation instead.", "READ_ONLY_VIOLATION")
    this.name = "ReadOnlyError"
  }
}

export class RecordNotFoundError extends ReactiveBaseError {
  constructor(tableName: string, id: string) {
    super(`Record not found in "${tableName}" with id "${id}"`, "RECORD_NOT_FOUND")
    this.name = "RecordNotFoundError"
  }
}

export class FunctionNotFoundError extends ReactiveBaseError {
  constructor(name: string) {
    super(`Query function not found: "${name}"`, "FUNCTION_NOT_FOUND")
    this.name = "FunctionNotFoundError"
  }
}

export class NotQueryFunctionError extends ReactiveBaseError {
  constructor(name: string) {
    super(`"${name}" is not a query function`, "NOT_QUERY_FUNCTION")
    this.name = "NotQueryFunctionError"
  }
}

export class CircularDependencyError extends ReactiveBaseError {
  constructor(cycle: string) {
    super(`Circular query dependency detected: ${cycle}`, "CIRCULAR_DEPENDENCY")
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
    super(`Invalid message: ${detail}`, "INVALID_MESSAGE")
    this.name = "InvalidMessageError"
  }
}

export class SchemaValidationError extends ReactiveBaseError {
  constructor(message: string) {
    super(message, "SCHEMA_VALIDATION_ERROR")
    this.name = "SchemaValidationError"
  }
}
