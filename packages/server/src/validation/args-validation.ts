/**
 * Argument validation for ReactiveBase functions.
 * Provides a lightweight schema validation DSL compatible with
 * the existing validator pattern.
 */

export interface ValidationSchema {
  [key: string]: FieldValidator
}

export interface FieldValidator {
  _type: string
  _required: boolean
  _checks: Array<(value: unknown) => string | null>
}

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR"
  readonly statusCode = 400

  /**
   * @param errors - Array of field-level validation errors
   */
  constructor(public readonly errors: Array<{ field: string; message: string }>) {
    super(`Validation failed: ${errors.map((e) => `${e.field}: ${e.message}`).join(", ")}`)
    this.name = "ValidationError"
  }
}

/**
 * Validate args against a schema.
 *
 * @param args - The arguments object to validate
 * @param schema - The validation schema to check against
 */
export function validateArgs(args: unknown, schema: ValidationSchema): void {
  if (typeof args !== "object" || args === null) {
    throw new ValidationError([{ field: "_root", message: "Args must be an object" }])
  }

  const obj = args as Record<string, unknown>
  const errors: Array<{ field: string; message: string }> = []

  for (const [field, validator] of Object.entries(schema)) {
    const value = obj[field]

    // Required check
    if (validator._required && (value === undefined || value === null)) {
      errors.push({ field, message: "Required" })
      continue
    }

    if (value === undefined || value === null) continue

    // Type check
    const typeError = checkType(value, validator._type)
    if (typeError) {
      errors.push({ field, message: typeError })
      continue
    }

    // Custom checks
    for (const check of validator._checks) {
      const msg = check(value)
      if (msg) errors.push({ field, message: msg })
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors)
  }
}

function checkType(value: unknown, type: string): string | null {
  switch (type) {
    case "string":
      return typeof value === "string" ? null : "Must be a string"
    case "number":
      return typeof value === "number" && !isNaN(value) ? null : "Must be a number"
    case "boolean":
      return typeof value === "boolean" ? null : "Must be a boolean"
    case "array":
      return Array.isArray(value) ? null : "Must be an array"
    case "object":
      return typeof value === "object" && !Array.isArray(value) ? null : "Must be an object"
    default:
      return null
  }
}

// --- Validator builders ---

function createFieldValidator(type: string, required: boolean): FieldValidator {
  return { _type: type, _required: required, _checks: [] }
}

export const s = {
  /**
   * Create a required string field validator with chainable constraints.
   *
   * @returns A string field validator supporting `.optional()`, `.min()`, `.max()`, `.email()`, `.pattern()`
   */
  string() {
    const v = createFieldValidator("string", true)
    return Object.assign(v, {
      optional() {
        v._required = false
        return this
      },
      min(n: number) {
        v._checks.push((val) => ((val as string).length < n ? `Min length: ${n}` : null))
        return this
      },
      max(n: number) {
        v._checks.push((val) => ((val as string).length > n ? `Max length: ${n}` : null))
        return this
      },
      email() {
        v._checks.push((val) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val as string) ? null : "Invalid email"))
        return this
      },
      pattern(re: RegExp) {
        v._checks.push((val) => (re.test(val as string) ? null : `Must match ${re}`))
        return this
      },
    })
  },

  /**
   * Create a required number field validator with chainable constraints.
   *
   * @returns A number field validator supporting `.optional()`, `.min()`, `.max()`, `.integer()`
   */
  number() {
    const v = createFieldValidator("number", true)
    return Object.assign(v, {
      optional() {
        v._required = false
        return this
      },
      min(n: number) {
        v._checks.push((val) => ((val as number) < n ? `Min: ${n}` : null))
        return this
      },
      max(n: number) {
        v._checks.push((val) => ((val as number) > n ? `Max: ${n}` : null))
        return this
      },
      integer() {
        v._checks.push((val) => (Number.isInteger(val) ? null : "Must be an integer"))
        return this
      },
    })
  },

  /**
   * Create a required boolean field validator.
   *
   * @returns A boolean field validator supporting `.optional()`
   */
  boolean() {
    const v = createFieldValidator("boolean", true)
    return Object.assign(v, {
      optional() {
        v._required = false
        return this
      },
    })
  },

  /**
   * Create a required array field validator with chainable constraints.
   *
   * @returns An array field validator supporting `.optional()`, `.minLength()`, `.maxLength()`
   */
  array() {
    const v = createFieldValidator("array", true)
    return Object.assign(v, {
      optional() {
        v._required = false
        return this
      },
      minLength(n: number) {
        v._checks.push((val) => ((val as unknown[]).length < n ? `Min items: ${n}` : null))
        return this
      },
      maxLength(n: number) {
        v._checks.push((val) => ((val as unknown[]).length > n ? `Max items: ${n}` : null))
        return this
      },
    })
  },
}

/**
 * Create a validation middleware for a specific function.
 *
 * @param schema - The validation schema to apply
 * @returns An object with a before hook that validates args
 */
export function withValidation(schema: ValidationSchema) {
  return {
    before(args: unknown): void {
      validateArgs(args, schema)
    },
  }
}
