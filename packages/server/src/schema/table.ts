/**
 * Table definition with typed columns, indexes, and relations.
 */

import type { Validator } from "./validators.js"

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

export interface TableDefinition<TColumns extends ColumnDefinitions = ColumnDefinitions> {
  readonly name: string
  readonly columns: TColumns
  readonly indexes: IndexDefinition[]
  readonly relations: RelationDefinition[]

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

class TableDefinitionImpl<TColumns extends ColumnDefinitions> implements TableDefinition<TColumns> {
  readonly indexes: IndexDefinition[] = []
  readonly relations: RelationDefinition[] = []

  constructor(
    readonly name: string,
    readonly columns: TColumns,
  ) {}

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

export function defineTable<TColumns extends ColumnDefinitions>(columns: TColumns): TableDefinition<TColumns> {
  return new TableDefinitionImpl("", columns)
}
