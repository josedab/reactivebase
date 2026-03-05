/**
 * SQL dialect translators and DDL translation utilities.
 */

import type { DatabaseDialect, SQLTranslator } from "./adapter-types.js"

export const postgresTranslator: SQLTranslator = {
  translateParams(sql: string): string {
    return sql // Postgres uses $1, $2 natively
  },
  returning(columns?: string[]): string {
    return columns ? `RETURNING ${columns.join(", ")}` : "RETURNING *"
  },
  upsert(table: string, columns: string[], conflictColumns: string[]): string {
    const cols = columns.join(", ")
    const vals = columns.map((_, i) => `$${i + 1}`).join(", ")
    const updates = columns
      .filter((c) => !conflictColumns.includes(c))
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ")
    return `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT (${conflictColumns.join(", ")}) DO UPDATE SET ${updates}`
  },
  jsonAgg(expression: string): string {
    return `json_agg(${expression})`
  },
  now(): string {
    return "NOW()"
  },
  uuid(): string {
    return "gen_random_uuid()"
  },
  paginate(limit: number, offset: number): string {
    return `LIMIT ${limit} OFFSET ${offset}`
  },
  boolean(value: boolean): string {
    return value ? "TRUE" : "FALSE"
  },
}

export const sqliteTranslator: SQLTranslator = {
  translateParams(sql: string): string {
    return sql.replace(/\$\d+/g, "?")
  },
  returning(columns?: string[]): string {
    return columns ? `RETURNING ${columns.join(", ")}` : "RETURNING *"
  },
  upsert(table: string, columns: string[], conflictColumns: string[]): string {
    const cols = columns.join(", ")
    const vals = columns.map(() => "?").join(", ")
    const updates = columns
      .filter((c) => !conflictColumns.includes(c))
      .map((c) => `${c} = excluded.${c}`)
      .join(", ")
    return `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT (${conflictColumns.join(", ")}) DO UPDATE SET ${updates}`
  },
  jsonAgg(expression: string): string {
    return `json_group_array(${expression})`
  },
  now(): string {
    return "datetime('now')"
  },
  uuid(): string {
    return "lower(hex(randomblob(16)))"
  },
  paginate(limit: number, offset: number): string {
    return `LIMIT ${limit} OFFSET ${offset}`
  },
  boolean(value: boolean): string {
    return value ? "1" : "0"
  },
}

export const mysqlTranslator: SQLTranslator = {
  translateParams(sql: string): string {
    return sql.replace(/\$\d+/g, "?")
  },
  returning(_columns?: string[]): string {
    return "" // MySQL 8 has limited RETURNING support; use LAST_INSERT_ID()
  },
  upsert(table: string, columns: string[], _conflictColumns: string[]): string {
    const cols = columns.join(", ")
    const vals = columns.map(() => "?").join(", ")
    const updates = columns.map((c) => `${c} = VALUES(${c})`).join(", ")
    return `INSERT INTO \`${table}\` (${cols}) VALUES (${vals}) ON DUPLICATE KEY UPDATE ${updates}`
  },
  jsonAgg(expression: string): string {
    return `JSON_ARRAYAGG(${expression})`
  },
  now(): string {
    return "NOW()"
  },
  uuid(): string {
    return "UUID()"
  },
  paginate(limit: number, offset: number): string {
    return `LIMIT ${limit} OFFSET ${offset}`
  },
  boolean(value: boolean): string {
    return value ? "TRUE" : "FALSE"
  },
}

export function getTranslator(dialect: DatabaseDialect): SQLTranslator {
  switch (dialect) {
    case "postgres":
      return postgresTranslator
    case "sqlite":
      return sqliteTranslator
    case "mysql":
      return mysqlTranslator
  }
}

// ─── Schema DDL Translation ──────────────────────────────────────────────────

export function translateColumnType(pgType: string, dialect: DatabaseDialect): string {
  if (dialect === "postgres") return pgType

  const typeMap: Record<string, Record<string, string>> = {
    text: { sqlite: "TEXT", mysql: "VARCHAR(255)" },
    integer: { sqlite: "INTEGER", mysql: "INT" },
    "double precision": { sqlite: "REAL", mysql: "DOUBLE" },
    boolean: { sqlite: "INTEGER", mysql: "TINYINT(1)" },
    timestamptz: { sqlite: "TEXT", mysql: "DATETIME" },
    jsonb: { sqlite: "TEXT", mysql: "JSON" },
    serial: { sqlite: "INTEGER PRIMARY KEY AUTOINCREMENT", mysql: "INT AUTO_INCREMENT" },
  }

  const mapped = typeMap[pgType.toLowerCase()]
  return mapped?.[dialect] ?? pgType
}

export function translateCreateTable(
  tableName: string,
  columns: Record<string, { pgType: string; isOptional: boolean }>,
  dialect: DatabaseDialect,
): string {
  const lines: string[] = []

  if (dialect === "mysql") {
    lines.push(`CREATE TABLE IF NOT EXISTS \`${tableName}\` (`)
  } else {
    lines.push(`CREATE TABLE IF NOT EXISTS "${tableName}" (`)
  }

  const quote = dialect === "mysql" ? "`" : '"'
  lines.push(
    `  ${quote}id${quote} ${dialect === "sqlite" ? "TEXT" : dialect === "mysql" ? "VARCHAR(36)" : "TEXT"} PRIMARY KEY DEFAULT ${getTranslator(dialect).uuid()}`,
  )

  for (const [name, col] of Object.entries(columns)) {
    const type = translateColumnType(col.pgType, dialect)
    const nullable = col.isOptional ? "" : " NOT NULL"
    lines.push(`  , ${quote}${name}${quote} ${type}${nullable}`)
  }

  lines.push(")")
  if (dialect === "mysql") {
    lines.push(" ENGINE=InnoDB DEFAULT CHARSET=utf8mb4")
  }

  return lines.join("\n")
}
