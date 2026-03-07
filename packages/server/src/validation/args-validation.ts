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
  _nullable?: boolean
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

    // Required check — nullable fields allow null
    if (validator._required && (value === undefined || (value === null && !validator._nullable))) {
      errors.push({ field, message: "Required" })
      continue
    }

    // Skip further checks for null/undefined (nullable passes through to custom checks)
    if (value === undefined) continue
    if (value === null && !validator._nullable) continue

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
      url() {
        v._checks.push((val) => {
          try {
            new URL(val as string)
            return null
          } catch {
            return "Invalid URL"
          }
        })
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

  /**
   * Create a required ID reference field validator.
   * Validates that the value is a non-empty string.
   *
   * @param table - Optional table name for documentation purposes
   * @returns An ID field validator
   */
  id(_table?: string) {
    const v = createFieldValidator("string", true)
    v._checks.push((val) => {
      if (typeof val !== "string" || val.length === 0) return "Must be a non-empty ID string"
      return null
    })
    return Object.assign(v, {
      optional() {
        v._required = false
        return this
      },
    })
  },

  /**
   * Create a required enum field validator restricted to specific values.
   *
   * @param allowedValues - The set of allowed string values
   * @returns An enum field validator
   */
  enum<T extends string>(allowedValues: readonly T[]) {
    const v = createFieldValidator("string", true)
    v._checks.push((val) => {
      if (!(allowedValues as readonly string[]).includes(val as string)) {
        return `Must be one of: ${allowedValues.join(", ")}`
      }
      return null
    })
    return Object.assign(v, {
      optional() {
        v._required = false
        return this
      },
    })
  },

  /**
   * Create a required nested object field validator.
   * Validates that the value is an object and recursively validates its fields.
   *
   * @param schema - The nested validation schema
   * @returns An object field validator
   */
  object(schema: ValidationSchema) {
    const v = createFieldValidator("object", true)
    v._checks.push((val) => {
      if (typeof val !== "object" || val === null || Array.isArray(val)) {
        return "Must be an object"
      }
      const obj = val as Record<string, unknown>
      const errors: string[] = []
      for (const [field, fieldValidator] of Object.entries(schema)) {
        const fieldValue = obj[field]
        if (fieldValidator._required && (fieldValue === undefined || fieldValue === null)) {
          errors.push(`${field}: Required`)
          continue
        }
        if (fieldValue === undefined || fieldValue === null) continue
        const typeError = checkType(fieldValue, fieldValidator._type)
        if (typeError) {
          errors.push(`${field}: ${typeError}`)
          continue
        }
        for (const check of fieldValidator._checks) {
          const msg = check(fieldValue)
          if (msg) errors.push(`${field}: ${msg}`)
        }
      }
      return errors.length > 0 ? errors.join("; ") : null
    })
    return Object.assign(v, {
      optional() {
        v._required = false
        return this
      },
    })
  },

  /**
   * Create a required URL field validator.
   * Validates that the value is a valid URL using the URL constructor.
   *
   * @returns A URL field validator
   */
  url() {
    const v = createFieldValidator("string", true)
    v._checks.push((val) => {
      try {
        new URL(val as string)
        return null
      } catch {
        return "Invalid URL"
      }
    })
    return Object.assign(v, {
      optional() {
        v._required = false
        return this
      },
    })
  },

  /**
   * Create a nullable field validator that wraps another validator.
   * Accepts null as a valid value in addition to the wrapped type.
   *
   * @param inner - The field validator to wrap (e.g., `s.string()`, `s.number()`)
   * @returns A nullable field validator
   */
  nullable(inner: FieldValidator): FieldValidator {
    const v = createFieldValidator(inner._type, inner._required)
    v._nullable = true
    v._checks.push((val) => {
      if (val === null) return null
      const typeError = checkType(val, inner._type)
      if (typeError) return typeError
      for (const check of inner._checks) {
        const msg = check(val)
        if (msg) return msg
      }
      return null
    })
    // Skip the default type check since we handle it in our custom check
    v._type = "any"
    return Object.assign(v, {
      optional() {
        v._required = false
        return this
      },
    })
  },

  /**
   * Create a union field validator that accepts multiple types.
   * Value must match at least one of the provided validators.
   *
   * @param variants - Array of field validators representing allowed types
   * @returns A union field validator
   *
   * @example
   * s.union([s.string(), s.number()])
   */
  union(variants: FieldValidator[]): FieldValidator {
    const v = createFieldValidator("any", true)
    v._checks.push((val) => {
      for (const variant of variants) {
        const typeErr = variant._type !== "any" ? checkType(val, variant._type) : null
        if (typeErr) continue
        const checkErrors = variant._checks.map((c) => c(val)).filter(Boolean)
        if (checkErrors.length === 0) return null
      }
      const typeNames = variants.map((vr) => vr._type).join(" | ")
      return `Must match one of: ${typeNames}`
    })
    return Object.assign(v, {
      optional() {
        v._required = false
        return this
      },
    })
  },

  /**
   * Create a typed array field validator with item-level validation.
   * Each element in the array must pass the provided item validator.
   *
   * @param itemValidator - Validator applied to each array element
   * @returns A typed array field validator
   *
   * @example
   * s.arrayOf(s.string().email())  // array of email strings
   * s.arrayOf(s.number().min(0))   // array of non-negative numbers
   */
  arrayOf(itemValidator: FieldValidator) {
    const v = createFieldValidator("array", true)
    v._checks.push((val) => {
      if (!Array.isArray(val)) return "Must be an array"
      const errors: string[] = []
      for (let i = 0; i < val.length; i++) {
        const item = val[i]
        if (itemValidator._type !== "any") {
          const typeErr = checkType(item, itemValidator._type)
          if (typeErr) {
            errors.push(`[${i}]: ${typeErr}`)
            continue
          }
        }
        for (const check of itemValidator._checks) {
          const msg = check(item)
          if (msg) errors.push(`[${i}]: ${msg}`)
        }
      }
      return errors.length > 0 ? errors.join("; ") : null
    })
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
