/**
 * Extension-Aware Schema Types & Query Builder for ReactiveBase.
 * Provides schema-level integration for Postgres extensions with custom
 * validator types and extension-aware query builder methods.
 *
 * Features:
 *   - v.geometry() type for PostGIS
 *   - v.vector(dims) type for pgvector
 *   - v.timeseries() type for TimescaleDB
 *   - v.trgm() type for pg_trgm fuzzy search
 *   - v.cron() type for pg_cron scheduling
 *   - Extension-aware DDL generation
 *   - Query builder methods: .nearestTo(), .withinRadius(), .similarTo()
 *
 * Usage:
 *   import { v } from '@reactivebase/server/pg-extensions'
 *   const schema = defineSchema({
 *     locations: defineTable({
 *       name: v.string(),
 *       coords: v.geometry('POINT'),
 *       embedding: v.vector(1536),
 *       readings: v.timeseries(),
 *     })
 *   })
 */

// ─── Extension Type Validators ───────────────────────────────────────────────

export interface ExtensionValidator {
  type: string
  isOptional: boolean
  extension: string
  innerValidator?: { type: string }
  /** Extension-specific configuration */
  config: GeometryConfig | VectorConfig | TimeseriesConfig | Record<string, unknown>
}

export interface GeometryConfig {
  /** PostGIS geometry type (POINT, LINESTRING, POLYGON, etc.) */
  geometryType: string
  /** SRID for coordinate system (default: 4326 = WGS84) */
  srid: number
}

export interface VectorConfig {
  /** Number of dimensions */
  dimensions: number
  /** Distance function (default: "cosine") */
  distanceFunction: "cosine" | "l2" | "inner_product"
}

export interface TimeseriesConfig {
  /** Chunk interval (default: "1 day") */
  chunkInterval: string
  /** Compression after interval (default: "7 days") */
  compressAfter: string | null
  /** Retention period (default: null = forever) */
  retentionPeriod: string | null
}

/**
 * Extension-aware type validators.
 */
export const v = {
  /**
   * PostGIS geometry type.
   * Generates: geometry(POINT, 4326)
   */
  geometry(geometryType = "POINT", srid = 4326): ExtensionValidator {
    return {
      type: "geometry",
      isOptional: false,
      extension: "postgis",
      config: { geometryType, srid } as GeometryConfig,
    }
  },

  /**
   * pgvector vector type.
   * Generates: vector(1536)
   */
  vector(dimensions: number, distanceFunction: VectorConfig["distanceFunction"] = "cosine"): ExtensionValidator {
    if (dimensions < 1 || dimensions > 16000) {
      throw new ExtensionTypeError(`Vector dimensions must be between 1 and 16000 (got ${dimensions})`)
    }
    return {
      type: "vector",
      isOptional: false,
      extension: "pgvector",
      config: { dimensions, distanceFunction } as VectorConfig,
    }
  },

  /**
   * TimescaleDB timeseries column marker.
   * Marks this table for hypertable conversion.
   */
  timeseries(options?: Partial<TimeseriesConfig>): ExtensionValidator {
    return {
      type: "timeseries",
      isOptional: false,
      extension: "timescaledb",
      config: {
        chunkInterval: options?.chunkInterval ?? "1 day",
        compressAfter: options?.compressAfter ?? null,
        retentionPeriod: options?.retentionPeriod ?? null,
      } as TimeseriesConfig,
    }
  },

  /**
   * pg_trgm trigram index marker.
   * Enables fuzzy text search on this column.
   */
  trgm(): ExtensionValidator {
    return {
      type: "trgm",
      isOptional: false,
      extension: "pg_trgm",
      config: {},
    }
  },

  /**
   * pg_cron schedule expression.
   * For storing cron schedule expressions.
   */
  cron(): ExtensionValidator {
    return {
      type: "cron",
      isOptional: false,
      extension: "pg_cron",
      config: {},
    }
  },
}

// ─── Extension DDL Generator ─────────────────────────────────────────────────

export interface ExtensionDDL {
  /** CREATE EXTENSION statements needed */
  createExtensions: string[]
  /** Column DDL (e.g., "coords geometry(POINT, 4326)") */
  columnDDL: string
  /** Additional DDL (indexes, hypertable conversion, etc.) */
  additionalDDL: string[]
}

/**
 * Generate DDL for an extension-aware column.
 */
export function generateExtensionColumnDDL(
  tableName: string,
  columnName: string,
  validator: ExtensionValidator,
): ExtensionDDL {
  const createExtensions: string[] = []
  let columnDDL: string
  const additionalDDL: string[] = []

  switch (validator.extension) {
    case "postgis": {
      createExtensions.push("CREATE EXTENSION IF NOT EXISTS postgis")
      const geo = validator.config as GeometryConfig
      columnDDL = `"${columnName}" geometry(${geo.geometryType}, ${geo.srid})`
      // Add spatial index
      additionalDDL.push(
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_${columnName}_gist ON "${tableName}" USING GIST ("${columnName}")`,
      )
      break
    }
    case "pgvector": {
      createExtensions.push("CREATE EXTENSION IF NOT EXISTS vector")
      const vec = validator.config as VectorConfig
      columnDDL = `"${columnName}" vector(${vec.dimensions})`
      // Add vector index based on distance function
      const opsClass =
        vec.distanceFunction === "cosine"
          ? "vector_cosine_ops"
          : vec.distanceFunction === "l2"
            ? "vector_l2_ops"
            : "vector_ip_ops"
      additionalDDL.push(
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_${columnName}_ivfflat ON "${tableName}" USING ivfflat ("${columnName}" ${opsClass})`,
      )
      break
    }
    case "timescaledb": {
      createExtensions.push("CREATE EXTENSION IF NOT EXISTS timescaledb")
      columnDDL = `"${columnName}" TIMESTAMPTZ NOT NULL`
      const ts = validator.config as TimeseriesConfig
      additionalDDL.push(
        `SELECT create_hypertable('"${tableName}"', '${columnName}', chunk_time_interval => INTERVAL '${ts.chunkInterval}')`,
      )
      if (ts.compressAfter) {
        additionalDDL.push(`ALTER TABLE "${tableName}" SET (timescaledb.compress)`)
        additionalDDL.push(`SELECT add_compression_policy('"${tableName}"', INTERVAL '${ts.compressAfter}')`)
      }
      if (ts.retentionPeriod) {
        additionalDDL.push(`SELECT add_retention_policy('"${tableName}"', INTERVAL '${ts.retentionPeriod}')`)
      }
      break
    }
    case "pg_trgm": {
      createExtensions.push("CREATE EXTENSION IF NOT EXISTS pg_trgm")
      columnDDL = `"${columnName}" TEXT`
      additionalDDL.push(
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_${columnName}_trgm ON "${tableName}" USING gin ("${columnName}" gin_trgm_ops)`,
      )
      break
    }
    case "pg_cron": {
      createExtensions.push("CREATE EXTENSION IF NOT EXISTS pg_cron")
      columnDDL = `"${columnName}" TEXT`
      break
    }
    default:
      columnDDL = `"${columnName}" TEXT`
  }

  return { createExtensions, columnDDL, additionalDDL }
}

// ─── Extension Query Builder ─────────────────────────────────────────────────

export interface ExtensionQueryResult {
  sql: string
  params: unknown[]
}

/**
 * Extension-aware query builder methods.
 */
export class ExtensionQueryBuilder {
  private tableName: string
  private conditions: string[] = []
  private params: unknown[] = []
  private paramCounter = 0
  private orderByClause: string | null = null
  private limitValue: number | null = null

  constructor(tableName: string) {
    this.tableName = tableName
  }

  /**
   * PostGIS: Find rows nearest to a point.
   */
  nearestTo(column: string, longitude: number, latitude: number, limit = 10): this {
    this.orderByClause = `"${column}" <-> ST_SetSRID(ST_MakePoint($${++this.paramCounter}, $${++this.paramCounter}), 4326)`
    this.params.push(longitude, latitude)
    this.limitValue = limit
    return this
  }

  /**
   * PostGIS: Find rows within a radius (meters).
   */
  withinRadius(column: string, longitude: number, latitude: number, radiusMeters: number): this {
    this.conditions.push(
      `ST_DWithin("${column}"::geography, ST_SetSRID(ST_MakePoint($${++this.paramCounter}, $${++this.paramCounter}), 4326)::geography, $${++this.paramCounter})`,
    )
    this.params.push(longitude, latitude, radiusMeters)
    return this
  }

  /**
   * PostGIS: Find rows within a bounding box.
   */
  withinBounds(column: string, minLon: number, minLat: number, maxLon: number, maxLat: number): this {
    this.conditions.push(
      `"${column}" && ST_MakeEnvelope($${++this.paramCounter}, $${++this.paramCounter}, $${++this.paramCounter}, $${++this.paramCounter}, 4326)`,
    )
    this.params.push(minLon, minLat, maxLon, maxLat)
    return this
  }

  /**
   * pgvector: Find rows with vectors similar to a given vector.
   */
  similarTo(
    column: string,
    queryVector: number[],
    limit = 10,
    distance: "cosine" | "l2" | "inner_product" = "cosine",
  ): this {
    const operator = distance === "cosine" ? "<=>" : distance === "l2" ? "<->" : "<#>"
    this.orderByClause = `"${column}" ${operator} $${++this.paramCounter}::vector`
    this.params.push(`[${queryVector.join(",")}]`)
    this.limitValue = limit
    return this
  }

  /**
   * pg_trgm: Fuzzy text search.
   */
  fuzzyMatch(column: string, query: string, threshold = 0.3): this {
    this.conditions.push(`similarity("${column}", $${++this.paramCounter}) > $${++this.paramCounter}`)
    this.params.push(query, threshold)
    this.orderByClause = this.orderByClause ?? `similarity("${column}", $${this.paramCounter - 1}) DESC`
    return this
  }

  /**
   * pg_trgm: Search with LIKE using trigram index.
   */
  trigramSearch(column: string, query: string): this {
    this.conditions.push(`"${column}" % $${++this.paramCounter}`)
    this.params.push(query)
    return this
  }

  /**
   * TimescaleDB: Query within a time range.
   */
  timeRange(column: string, start: Date, end: Date): this {
    this.conditions.push(`"${column}" >= $${++this.paramCounter} AND "${column}" <= $${++this.paramCounter}`)
    this.params.push(start.toISOString(), end.toISOString())
    return this
  }

  /**
   * TimescaleDB: Aggregate by time bucket.
   */
  timeBucket(
    column: string,
    interval: string,
    aggregateColumn: string,
    aggregate: "avg" | "sum" | "count" | "min" | "max" = "avg",
  ): ExtensionQueryResult {
    const bucketAlias = "time_bucket"
    return {
      sql: `SELECT time_bucket($${++this.paramCounter}, "${column}") AS ${bucketAlias}, ${aggregate}("${aggregateColumn}") AS value FROM "${this.tableName}" ${this.buildWhere()} GROUP BY ${bucketAlias} ORDER BY ${bucketAlias}`,
      params: [...this.params, interval],
    }
  }

  /**
   * Add a generic WHERE condition.
   */
  where(column: string, operator: string, value: unknown): this {
    this.conditions.push(`"${column}" ${operator} $${++this.paramCounter}`)
    this.params.push(value)
    return this
  }

  /**
   * Set limit.
   */
  limit(n: number): this {
    this.limitValue = n
    return this
  }

  /**
   * Build the final SQL query.
   */
  build(): ExtensionQueryResult {
    let sql = `SELECT * FROM "${this.tableName}"`
    sql += this.buildWhere()
    if (this.orderByClause) sql += ` ORDER BY ${this.orderByClause}`
    if (this.limitValue) sql += ` LIMIT ${this.limitValue}`

    return { sql, params: [...this.params] }
  }

  private buildWhere(): string {
    if (this.conditions.length === 0) return ""
    return ` WHERE ${this.conditions.join(" AND ")}`
  }
}

/**
 * Create an extension-aware query builder for a table.
 */
export function extQuery(tableName: string): ExtensionQueryBuilder {
  return new ExtensionQueryBuilder(tableName)
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class ExtensionTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExtensionTypeError"
  }
}
