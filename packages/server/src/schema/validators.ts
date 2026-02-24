/**
 * Schema validators for defining table columns.
 * Each validator maps to a Postgres type and produces TypeScript types.
 */

export type ValidatorType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "timestamp"
  | "json"
  | "array"
  | "enum"
  | "id"
  | "optional"
  | "custom"
  | "vector"

export interface ValidatorOptions {
  default?: unknown
  onUpdate?: string
  minLength?: number
  maxLength?: number
  min?: number | string
  max?: number | string
  /** @internal Mark field for encryption middleware */
  __encrypted?: boolean
  /** @internal Mark field as searchable for full-text search */
  __searchable?: boolean
  /** @internal Search weight (A-D) */
  __searchWeight?: "A" | "B" | "C" | "D"
  /** @internal Search language */
  __searchLanguage?: string
}

export interface Validator<T = unknown> {
  readonly type: ValidatorType
  readonly tsType: T
  readonly pgType: string
  readonly isOptional: boolean
  readonly options: ValidatorOptions
  readonly enumValues?: readonly string[]
  readonly referencedTable?: string
  readonly innerValidator?: Validator
  readonly dimensions?: number
}

function createValidator<T>(
  type: ValidatorType,
  pgType: string,
  options: ValidatorOptions = {},
  extra: Partial<Validator<T>> = {},
): Validator<T> {
  return {
    type,
    tsType: undefined as unknown as T,
    pgType,
    isOptional: false,
    options,
    ...extra,
  }
}

export const v = {
  string(options: ValidatorOptions = {}): Validator<string> {
    return createValidator("string", "text", options)
  },

  number(options: ValidatorOptions = {}): Validator<number> {
    return createValidator("number", "double precision", options)
  },

  integer(options: ValidatorOptions = {}): Validator<number> {
    return createValidator("integer", "integer", options)
  },

  boolean(options: ValidatorOptions & { default?: boolean } = {}): Validator<boolean> {
    return createValidator("boolean", "boolean", options)
  },

  timestamp(options: ValidatorOptions & { default?: "now" | string } = {}): Validator<Date> {
    return createValidator("timestamp", "timestamptz", options)
  },

  json<T = unknown>(options: ValidatorOptions = {}): Validator<T> {
    return createValidator("json", "jsonb", options)
  },

  array<T>(inner: Validator<T>): Validator<T[]> {
    return createValidator("array", `${inner.pgType}[]`, {}, { innerValidator: inner as Validator })
  },

  enum<T extends string>(...values: T[]): Validator<T> {
    return createValidator("enum", "text", {}, { enumValues: values })
  },

  id<TableName extends string>(table: TableName): Validator<string> {
    return createValidator("id", "text", {}, { referencedTable: table })
  },

  optional<T>(inner: Validator<T>): Validator<T | undefined> {
    return {
      ...inner,
      type: "optional",
      isOptional: true,
      innerValidator: inner as Validator,
    } as Validator<T | undefined>
  },

  custom<T>(pgType: string): Validator<T> {
    return createValidator("custom", pgType)
  },

  vector(dimensions: number): Validator<number[]> {
    return createValidator("vector", `vector(${dimensions})`, {}, { dimensions })
  },

  storageId(): Validator<string> {
    return createValidator("id", "text", {})
  },

  /**
   * Field-level encryption validator.
   * Wraps an inner validator to transparently encrypt/decrypt at the field level.
   * Data is stored as encrypted JSONB in Postgres.
   */
  encrypted<T>(inner: Validator<T>): Validator<T> {
    return createValidator(
      "custom",
      "jsonb",
      {},
      {
        innerValidator: inner as Validator,
        // Mark this field for encryption middleware
        options: { ...inner.options, __encrypted: true },
      },
    )
  },

  /**
   * Mark a string column as searchable for full-text search.
   * Generates a GIN index on the tsvector representation.
   */
  searchable(options: { weight?: "A" | "B" | "C" | "D"; language?: string } = {}): Validator<string> {
    return createValidator(
      "string",
      "text",
      { __searchable: true, __searchWeight: options.weight, __searchLanguage: options.language },
    )
  },
} as const
