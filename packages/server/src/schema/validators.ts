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
  | "computed"
  | "virtual"

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

/** Function signature for computed/virtual field derivation */
export type ComputedFieldFn<T = unknown> = (row: Record<string, unknown>) => T

/** SQL expression for server-side computed columns */
export type ComputedSqlExpr = string

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
  /** Derivation function for computed/virtual fields */
  readonly computeFn?: ComputedFieldFn<T>
  /** SQL expression for server-side computed columns (GENERATED ALWAYS AS) */
  readonly computeSql?: ComputedSqlExpr
  /** Tables this computed/virtual field depends on for reactivity */
  readonly dependsOnTables?: readonly string[]
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
    return createValidator("string", "text", {
      __searchable: true,
      __searchWeight: options.weight,
      __searchLanguage: options.language,
    })
  },

  /**
   * Define a server-side computed column (Postgres GENERATED ALWAYS AS).
   * The SQL expression is stored and computed by Postgres; the derivation
   * function is used for in-memory evaluation and type inference.
   */
  computed<T>(options: {
    sql: ComputedSqlExpr
    returning: Validator<T>
    fn?: ComputedFieldFn<T>
    dependsOn?: string[]
  }): Validator<T> {
    if (!options.sql || typeof options.sql !== "string" || options.sql.trim().length === 0) {
      throw new Error("v.computed() requires a non-empty SQL expression")
    }
    if (!options.returning) {
      throw new Error("v.computed() requires a 'returning' validator for type inference")
    }
    // Block dangerous SQL patterns in computed expressions
    const sqlUpper = options.sql.toUpperCase()
    if (
      sqlUpper.includes("DROP ") ||
      sqlUpper.includes("DELETE ") ||
      sqlUpper.includes("INSERT ") ||
      sqlUpper.includes("UPDATE ") ||
      sqlUpper.includes("ALTER ") ||
      sqlUpper.includes("TRUNCATE ")
    ) {
      throw new Error("v.computed() SQL expression must not contain DDL/DML statements")
    }
    return {
      type: "computed",
      tsType: undefined as unknown as T,
      pgType: options.returning.pgType,
      isOptional: false,
      options: {},
      computeSql: options.sql,
      computeFn: options.fn,
      dependsOnTables: options.dependsOn,
      innerValidator: options.returning as Validator,
    } as Validator<T>
  },

  /**
   * Define a virtual field computed at query time (not stored in Postgres).
   * The derivation function runs server-side after row fetch. Cross-table
   * dependencies are tracked for automatic reactivity invalidation.
   */
  virtual<T>(options: { fn: ComputedFieldFn<T>; returning: Validator<T>; dependsOn?: string[] }): Validator<T> {
    if (!options.fn || typeof options.fn !== "function") {
      throw new Error("v.virtual() requires a derivation function ('fn')")
    }
    if (!options.returning) {
      throw new Error("v.virtual() requires a 'returning' validator for type inference")
    }
    return {
      type: "virtual",
      tsType: undefined as unknown as T,
      pgType: options.returning.pgType,
      isOptional: false,
      options: {},
      computeFn: options.fn,
      dependsOnTables: options.dependsOn,
      innerValidator: options.returning as Validator,
    } as Validator<T>
  },
} as const
