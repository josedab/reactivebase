/**
 * Table definition with typed columns, indexes, and relations.
 */

import type { Validator } from "./validators.js"
import { v } from "./validators.js"

export interface IndexDefinition {
  name: string
  columns: string[]
  unique: boolean
  type?: "btree" | "ivfflat" | "hnsw"
  opclass?: string
}

export interface RelationDefinition {
  name: string
  from: string
  to: string
}

export type ColumnDefinitions = Record<string, Validator>

export interface TableOptions {
  /** Disable automatic `_createdAt` / `_updatedAt` system fields. Default: false. */
  disableTimestamps?: boolean
}

export interface TableDefinition<TColumns extends ColumnDefinitions = ColumnDefinitions> {
  readonly name: string
  readonly columns: TColumns
  readonly indexes: IndexDefinition[]
  readonly relations: RelationDefinition[]
  readonly hasSystemTimestamps: boolean

  index(name: string, columns: (keyof TColumns & string)[], options?: { unique?: boolean }): TableDefinition<TColumns>

  vectorIndex(
    name: string,
    column: keyof TColumns & string,
    options?: { type?: "ivfflat" | "hnsw"; metric?: "cosine" | "l2" | "inner_product" },
  ): TableDefinition<TColumns>

  relation(name: string, config: { from: string; to: string }): TableDefinition<TColumns>
}

/**
 * Infer the TypeScript type for a row from column definitions.
 */
export type InferRow<T extends ColumnDefinitions> = {
  [K in keyof T as T[K] extends { isOptional: true } ? never : K]: T[K]["tsType"]
} & {
  [K in keyof T as T[K] extends { isOptional: true } ? K : never]?: T[K]["tsType"]
} & { id: string }

/** System timestamp fields automatically added to every table. */
const SYSTEM_TIMESTAMP_COLUMNS = {
  _createdAt: v.timestamp({ default: "now" }),
  _updatedAt: v.timestamp({ default: "now", onUpdate: "now" }),
} as const

class TableDefinitionImpl<TColumns extends ColumnDefinitions> implements TableDefinition<TColumns> {
  readonly indexes: IndexDefinition[] = []
  readonly relations: RelationDefinition[] = []
  readonly hasSystemTimestamps: boolean

  constructor(
    readonly name: string,
    readonly columns: TColumns,
    options: TableOptions = {},
  ) {
    this.hasSystemTimestamps = !options.disableTimestamps

    if (this.hasSystemTimestamps) {
      // Inject system fields if not already defined by the user
      for (const [key, validator] of Object.entries(SYSTEM_TIMESTAMP_COLUMNS)) {
        if (!(key in this.columns)) {
          ;(this.columns as ColumnDefinitions)[key] = validator
        }
      }
    }
  }

  index(
    name: string,
    columns: (keyof TColumns & string)[],
    options: { unique?: boolean } = {},
  ): TableDefinition<TColumns> {
    this.indexes.push({
      name,
      columns: columns as string[],
      unique: options.unique ?? false,
    })
    return this
  }

  vectorIndex(
    name: string,
    column: keyof TColumns & string,
    options: { type?: "ivfflat" | "hnsw"; metric?: "cosine" | "l2" | "inner_product" } = {},
  ): TableDefinition<TColumns> {
    const metricToOpclass: Record<string, string> = {
      cosine: "vector_cosine_ops",
      l2: "vector_l2_ops",
      inner_product: "vector_ip_ops",
    }
    this.indexes.push({
      name,
      columns: [column as string],
      unique: false,
      type: options.type ?? "hnsw",
      opclass: metricToOpclass[options.metric ?? "cosine"],
    })
    return this
  }

  relation(name: string, config: { from: string; to: string }): TableDefinition<TColumns> {
    this.relations.push({ name, from: config.from, to: config.to })
    return this
  }
}

/**
 * Define a database table with typed columns.
 * Automatically includes `_createdAt` and `_updatedAt` system fields
 * unless `{ disableTimestamps: true }` is passed.
 *
 * @param columns - Column definitions using `v` validators
 * @param options - Table options (e.g., disableTimestamps)
 * @returns A table definition that can be passed to `defineSchema()`
 */
export function defineTable<TColumns extends ColumnDefinitions>(
  columns: TColumns,
  options?: TableOptions,
): TableDefinition<TColumns> {
  return new TableDefinitionImpl("", columns, options)
}
