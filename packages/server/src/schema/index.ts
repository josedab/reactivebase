export { v } from "./validators.js"
export type { Validator, ValidatorOptions, ValidatorType, ComputedFieldFn, ComputedSqlExpr } from "./validators.js"
export { defineTable } from "./table.js"
export type { TableDefinition, ColumnDefinitions, InferRow, IndexDefinition, RelationDefinition } from "./table.js"
export { defineSchema } from "./schema.js"
export type { Schema, SchemaDefinition, InferSchemaTypes } from "./schema.js"
export { generateMigrationSQL, generateCreateTableSQL, generateIndexSQL } from "./migrations.js"
export type { Migration } from "./migrations.js"

// Schema Version Registry
export {
  SchemaVersionRegistry,
  generateSchemaRegistryTableSQL,
} from "./schema-registry.js"
export type {
  SchemaVersion,
  SchemaTableSnapshot,
  SchemaColumnSnapshot,
  CompatibilityResult,
  BreakingChange,
  CompatibilityWarning,
  SchemaAddition,
  EvolutionAnalytics,
  DeprecationWarning,
} from "./schema-registry.js"
