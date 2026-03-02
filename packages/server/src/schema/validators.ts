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
  /**
   * Define a text column.
   *
   * @param options - Validator options such as default, minLength, maxLength
   * @returns A string validator mapping to Postgres `text`
   */
  string(options: ValidatorOptions = {}): Validator<string> {
    return createValidator("string", "text", options)
  },

  /**
   * Define a floating-point number column.
   *
   * @param options - Validator options such as default, min, max
   * @returns A number validator mapping to Postgres `double precision`
   */
  number(options: ValidatorOptions = {}): Validator<number> {
    return createValidator("number", "double precision", options)
  },

  /**
   * Define an integer column.
   *
   * @param options - Validator options such as default, min, max
   * @returns An integer validator mapping to Postgres `integer`
   */
  integer(options: ValidatorOptions = {}): Validator<number> {
    return createValidator("integer", "integer", options)
  },

  /**
   * Define a boolean column.
   *
   * @param options - Validator options such as default
   * @returns A boolean validator mapping to Postgres `boolean`
   */
  boolean(options: ValidatorOptions & { default?: boolean } = {}): Validator<boolean> {
    return createValidator("boolean", "boolean", options)
  },

  /**
   * Define a timestamp column with timezone.
   *
   * @param options - Validator options; use `default: "now"` for auto-timestamps
   * @returns A Date validator mapping to Postgres `timestamptz`
   */
  timestamp(options: ValidatorOptions & { default?: "now" | string } = {}): Validator<Date> {
    return createValidator("timestamp", "timestamptz", options)
  },

  /**
   * Define a JSON column.
   *
   * @param options - Validator options such as default
   * @returns A JSON validator mapping to Postgres `jsonb`
   */
  json<T = unknown>(options: ValidatorOptions = {}): Validator<T> {
    return createValidator("json", "jsonb", options)
  },

  /**
   * Define an array column wrapping an inner validator.
   *
   * @param inner - The element validator for array items
   * @returns An array validator mapping to a Postgres array type
   */
  array<T>(inner: Validator<T>): Validator<T[]> {
    return createValidator("array", `${inner.pgType}[]`, {}, { innerValidator: inner as Validator })
  },

  /**
   * Define an enum column restricted to specific string values.
   *
   * @param values - Allowed enum values
   * @returns An enum validator stored as Postgres `text`
   */
  enum<T extends string>(...values: T[]): Validator<T> {
    return createValidator("enum", "text", {}, { enumValues: values })
  },

  /**
   * Define a foreign key reference to another table.
   *
   * @param table - The name of the referenced table
   * @returns An ID validator stored as Postgres `text`
   */
  id<TableName extends string>(table: TableName): Validator<string> {
    return createValidator("id", "text", {}, { referencedTable: table })
  },

  /**
   * Mark a column as optional (nullable).
   *
   * @param inner - The inner validator to make optional
   * @returns A validator that allows `undefined` values
   */
  optional<T>(inner: Validator<T>): Validator<T | undefined> {
    return {
      ...inner,
      type: "optional",
      isOptional: true,
      innerValidator: inner as Validator,
    } as Validator<T | undefined>
  },

  /**
   * Define a column with a custom Postgres type.
   *
   * @param pgType - The raw Postgres type string
   * @returns A custom validator for the given Postgres type
   */
  custom<T>(pgType: string): Validator<T> {
    return createValidator("custom", pgType)
  },

  /**
   * Define a pgvector column for similarity search.
   *
   * @param dimensions - The number of dimensions for the vector
   * @returns A vector validator mapping to Postgres `vector(N)`
   */
  vector(dimensions: number): Validator<number[]> {
    return createValidator("vector", `vector(${dimensions})`, {}, { dimensions })
  },

  /**
   * Define a storage file reference column.
   *
   * @returns A string validator for referencing files in the storage backend
   */
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
