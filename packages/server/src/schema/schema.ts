/**
 * Schema definition - the single source of truth for data model.
 * Generates TypeScript types and Postgres DDL.
 */

import type { ColumnDefinitions, TableDefinition, InferRow } from "./table.js"

export type SchemaDefinition = Record<string, TableDefinition>

export interface Schema<T extends SchemaDefinition = SchemaDefinition> {
  readonly tables: {
    [K in keyof T]: T[K] & { readonly name: K & string }
  }
  readonly tableNames: (keyof T & string)[]
}

/**
 * Infer TypeScript row types for every table in the schema.
 */
export type InferSchemaTypes<T extends SchemaDefinition> = {
  [K in keyof T]: T[K] extends TableDefinition<infer C> ? InferRow<C> : never
}

class SchemaImpl<T extends SchemaDefinition> implements Schema<T> {
  readonly tables: { [K in keyof T]: T[K] & { readonly name: K & string } }
  readonly tableNames: (keyof T & string)[]

  constructor(definition: T) {
    this.tableNames = Object.keys(definition) as (keyof T & string)[]
    const tables = {} as Record<string, TableDefinition & { name: string }>

    for (const [name, tableDef] of Object.entries(definition)) {
      const table = Object.create(Object.getPrototypeOf(tableDef))
      Object.assign(table, tableDef)
      Object.defineProperty(table, "name", { value: name, writable: false })
      tables[name] = table as TableDefinition & { name: string }
    }

    this.tables = tables as typeof this.tables
  }
}

export function defineSchema<T extends SchemaDefinition>(definition: T): Schema<T> {
  validateSchema(definition)
  return new SchemaImpl(definition)
}

function validateSchema(definition: SchemaDefinition): void {
  const tableNames = new Set<string>()

  for (const [name, table] of Object.entries(definition)) {
    if (tableNames.has(name)) {
      throw new Error(`Duplicate table name: "${name}"`)
    }
    tableNames.add(name)

    // Validate index columns exist
    for (const index of table.indexes) {
      for (const col of index.columns) {
        if (!(col in table.columns)) {
          throw new Error(
            `Index "${index.name}" on table "${name}" references non-existent column "${col}"`,
          )
        }
      }
    }

    // Validate foreign key references
    for (const [colName, validator] of Object.entries(table.columns)) {
      if (validator.referencedTable && !definition[validator.referencedTable]) {
        throw new Error(
          `Column "${colName}" in table "${name}" references non-existent table "${validator.referencedTable}"`,
        )
      }
    }
  }
}
