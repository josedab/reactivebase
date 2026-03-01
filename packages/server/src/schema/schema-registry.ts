/**
 * Schema Version Registry for ReactiveBase.
 * Tracks schema changes over time, validates backward compatibility,
 * provides deprecation warnings, and evolution analytics.
 *
 * Usage:
 *   const registry = new SchemaVersionRegistry()
 *   registry.register({ version: 1, tables: [...], createdAt: Date.now() })
 *   registry.register({ version: 2, tables: [...], createdAt: Date.now() })
 *   const compat = registry.checkCompatibility(1, 2)
 *   const analytics = registry.getEvolutionAnalytics()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchemaVersion {
  version: number
  label?: string
  tables: SchemaTableSnapshot[]
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface SchemaTableSnapshot {
  name: string
  columns: SchemaColumnSnapshot[]
  indexes: string[]
}

export interface SchemaColumnSnapshot {
  name: string
  type: string
  nullable: boolean
  hasDefault: boolean
  deprecated?: boolean
  deprecationMessage?: string
}

export interface CompatibilityResult {
  compatible: boolean
  fromVersion: number
  toVersion: number
  breakingChanges: BreakingChange[]
  warnings: CompatibilityWarning[]
  additions: SchemaAddition[]
}

export interface BreakingChange {
  type: "table_removed" | "column_removed" | "type_changed" | "nullable_removed"
  table: string
  column?: string
  detail: string
}

export interface CompatibilityWarning {
  type: "column_deprecated" | "table_renamed" | "index_removed" | "type_widened"
  table: string
  column?: string
  message: string
}

export interface SchemaAddition {
  type: "table_added" | "column_added" | "index_added"
  table: string
  column?: string
}

export interface EvolutionAnalytics {
  totalVersions: number
  firstVersion: number
  latestVersion: number
  tablesOverTime: Array<{ version: number; tableCount: number }>
  columnsOverTime: Array<{ version: number; columnCount: number }>
  breakingChangeCount: number
  deprecatedColumns: Array<{ table: string; column: string; since: number; message?: string }>
  mostChangedTables: Array<{ table: string; changeCount: number }>
}

export interface DeprecationWarning {
  table: string
  column: string
  since: number
  message: string
}

// ─── Registry ────────────────────────────────────────────────────────────────

export class SchemaVersionRegistry {
  private versions = new Map<number, SchemaVersion>()

  /**
   * Register a new schema version.
   */
  register(version: SchemaVersion): void {
    if (this.versions.has(version.version)) {
      throw new Error(`Schema version ${version.version} already registered`)
    }
    this.versions.set(version.version, version)
  }

  /**
   * Get a specific schema version.
   */
  get(version: number): SchemaVersion | undefined {
    return this.versions.get(version)
  }

  /**
   * Get the latest registered version.
   */
  getLatest(): SchemaVersion | undefined {
    const sorted = this.getSortedVersions()
    return sorted.length > 0 ? sorted[sorted.length - 1] : undefined
  }

  /**
   * List all registered versions.
   */
  list(): SchemaVersion[] {
    return this.getSortedVersions()
  }

  /**
   * Check backward compatibility between two versions.
   */
  checkCompatibility(fromVersion: number, toVersion: number): CompatibilityResult {
    const from = this.versions.get(fromVersion)
    const to = this.versions.get(toVersion)
    if (!from) throw new Error(`Schema version ${fromVersion} not found`)
    if (!to) throw new Error(`Schema version ${toVersion} not found`)

    const breakingChanges: BreakingChange[] = []
    const warnings: CompatibilityWarning[] = []
    const additions: SchemaAddition[] = []

    const fromTableMap = new Map(from.tables.map((t) => [t.name, t]))
    const toTableMap = new Map(to.tables.map((t) => [t.name, t]))

    // Check for removed tables
    for (const [name] of Array.from(fromTableMap.entries())) {
      if (!toTableMap.has(name)) {
        breakingChanges.push({
          type: "table_removed",
          table: name,
          detail: `Table "${name}" was removed in version ${toVersion}`,
        })
      }
    }

    // Check for new tables
    for (const [name] of Array.from(toTableMap.entries())) {
      if (!fromTableMap.has(name)) {
        additions.push({ type: "table_added", table: name })
      }
    }

    // Check column-level changes
    for (const [name, toTable] of Array.from(toTableMap.entries())) {
      const fromTable = fromTableMap.get(name)
      if (!fromTable) continue

      const fromColMap = new Map(fromTable.columns.map((c) => [c.name, c]))
      const toColMap = new Map(toTable.columns.map((c) => [c.name, c]))

      // Removed columns
      for (const [colName] of Array.from(fromColMap.entries())) {
        if (!toColMap.has(colName)) {
          breakingChanges.push({
            type: "column_removed",
            table: name,
            column: colName,
            detail: `Column "${name}.${colName}" was removed`,
          })
        }
      }

      // New columns
      for (const [colName, toCol] of Array.from(toColMap.entries())) {
        const fromCol = fromColMap.get(colName)
        if (!fromCol) {
          additions.push({ type: "column_added", table: name, column: colName })

          // Non-nullable column without default is a breaking change
          if (!toCol.nullable && !toCol.hasDefault) {
            breakingChanges.push({
              type: "nullable_removed",
              table: name,
              column: colName,
              detail: `New non-nullable column "${name}.${colName}" without default — existing rows will fail`,
            })
          }
          continue
        }

        // Type changes
        if (fromCol.type !== toCol.type) {
          if (isTypeWidening(fromCol.type, toCol.type)) {
            warnings.push({
              type: "type_widened",
              table: name,
              column: colName,
              message: `Column "${name}.${colName}" type widened: ${fromCol.type} → ${toCol.type}`,
            })
          } else {
            breakingChanges.push({
              type: "type_changed",
              table: name,
              column: colName,
              detail: `Column "${name}.${colName}" type changed: ${fromCol.type} → ${toCol.type}`,
            })
          }
        }

        // Nullable → non-nullable
        if (fromCol.nullable && !toCol.nullable) {
          breakingChanges.push({
            type: "nullable_removed",
            table: name,
            column: colName,
            detail: `Column "${name}.${colName}" changed from nullable to non-nullable`,
          })
        }

        // Deprecation check
        if (toCol.deprecated && !fromCol.deprecated) {
          warnings.push({
            type: "column_deprecated",
            table: name,
            column: colName,
            message: toCol.deprecationMessage ?? `Column "${name}.${colName}" is deprecated`,
          })
        }
      }

      // Index changes
      const fromIndexes = new Set(fromTable.indexes)
      const toIndexes = new Set(toTable.indexes)
      for (const idx of Array.from(fromIndexes)) {
        if (!toIndexes.has(idx)) {
          warnings.push({
            type: "index_removed",
            table: name,
            message: `Index "${idx}" removed from "${name}"`,
          })
        }
      }
      for (const idx of Array.from(toIndexes)) {
        if (!fromIndexes.has(idx)) {
          additions.push({ type: "index_added", table: name })
        }
      }
    }

    return {
      compatible: breakingChanges.length === 0,
      fromVersion,
      toVersion,
      breakingChanges,
      warnings,
      additions,
    }
  }

  /**
   * Get deprecation warnings for the latest version.
   */
  getDeprecations(): DeprecationWarning[] {
    const latest = this.getLatest()
    if (!latest) return []

    const warnings: DeprecationWarning[] = []
    for (const table of latest.tables) {
      for (const col of table.columns) {
        if (col.deprecated) {
          warnings.push({
            table: table.name,
            column: col.name,
            since: latest.version,
            message: col.deprecationMessage ?? `Column "${table.name}.${col.name}" is deprecated`,
          })
        }
      }
    }

    // Check previous versions to find when deprecation started
    const sorted = this.getSortedVersions()
    for (const warning of warnings) {
      for (const version of sorted) {
        const table = version.tables.find((t) => t.name === warning.table)
        const col = table?.columns.find((c) => c.name === warning.column)
        if (col?.deprecated) {
          warning.since = version.version
        } else {
          break
        }
      }
    }

    return warnings
  }

  /**
   * Get evolution analytics across all versions.
   */
  getEvolutionAnalytics(): EvolutionAnalytics {
    const sorted = this.getSortedVersions()
    if (sorted.length === 0) {
      return {
        totalVersions: 0,
        firstVersion: 0,
        latestVersion: 0,
        tablesOverTime: [],
        columnsOverTime: [],
        breakingChangeCount: 0,
        deprecatedColumns: [],
        mostChangedTables: [],
      }
    }

    const tablesOverTime = sorted.map((v) => ({
      version: v.version,
      tableCount: v.tables.length,
    }))

    const columnsOverTime = sorted.map((v) => ({
      version: v.version,
      columnCount: v.tables.reduce((sum, t) => sum + t.columns.length, 0),
    }))

    // Count breaking changes between consecutive versions
    let breakingChangeCount = 0
    for (let i = 1; i < sorted.length; i++) {
      const compat = this.checkCompatibility(sorted[i - 1].version, sorted[i].version)
      breakingChangeCount += compat.breakingChanges.length
    }

    // Track table change frequency
    const tableChanges = new Map<string, number>()
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Set(sorted[i - 1].tables.map((t) => t.name))
      const curr = new Set(sorted[i].tables.map((t) => t.name))
      for (const name of Array.from(curr)) {
        if (!prev.has(name)) {
          tableChanges.set(name, (tableChanges.get(name) ?? 0) + 1)
        }
      }
      // Check column changes
      for (const table of sorted[i].tables) {
        const prevTable = sorted[i - 1].tables.find((t) => t.name === table.name)
        if (!prevTable) continue
        const prevCols = new Set(prevTable.columns.map((c) => c.name))
        const currCols = new Set(table.columns.map((c) => c.name))
        let changed = false
        for (const c of Array.from(currCols)) {
          if (!prevCols.has(c)) changed = true
        }
        for (const c of Array.from(prevCols)) {
          if (!currCols.has(c)) changed = true
        }
        if (changed) {
          tableChanges.set(table.name, (tableChanges.get(table.name) ?? 0) + 1)
        }
      }
    }

    return {
      totalVersions: sorted.length,
      firstVersion: sorted[0].version,
      latestVersion: sorted[sorted.length - 1].version,
      tablesOverTime,
      columnsOverTime,
      breakingChangeCount,
      deprecatedColumns: this.getDeprecations(),
      mostChangedTables: Array.from(tableChanges.entries())
        .map(([table, changeCount]) => ({ table, changeCount }))
        .sort((a, b) => b.changeCount - a.changeCount)
        .slice(0, 10),
    }
  }

  private getSortedVersions(): SchemaVersion[] {
    return Array.from(this.versions.values()).sort((a, b) => a.version - b.version)
  }
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateSchemaRegistryTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_schema_versions (
  version INTEGER PRIMARY KEY,
  label TEXT,
  tables JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _reactivebase_schema_compat_log (
  id SERIAL PRIMARY KEY,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  compatible BOOLEAN NOT NULL,
  breaking_changes JSONB DEFAULT '[]',
  warnings JSONB DEFAULT '[]',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`.trim()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_WIDENING: Record<string, string[]> = {
  integer: ["bigint", "numeric", "float", "double precision"],
  smallint: ["integer", "bigint", "numeric"],
  real: ["double precision", "numeric"],
  varchar: ["text"],
  char: ["varchar", "text"],
}

function isTypeWidening(from: string, to: string): boolean {
  const widenings = TYPE_WIDENING[from.toLowerCase()]
  return widenings ? widenings.includes(to.toLowerCase()) : false
}
