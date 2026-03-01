/**
 * Universal Database Seeding DSL
 *
 * Declarative seeding DSL that generates realistic, relationship-consistent
 * test data from schema definitions. Supports faker-style generators,
 * referential integrity, deterministic seeds, and dataset sizing.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type DatasetSize = "tiny" | "small" | "medium" | "large"

export interface SeedingProfile {
  readonly name: string
  readonly size: DatasetSize
  readonly deterministic: boolean
  readonly seed?: number
  readonly tables: Record<string, TableSeedConfig>
}

export interface TableSeedConfig {
  readonly count: number | ((size: DatasetSize) => number)
  readonly columns: Record<string, ColumnGenerator>
}

export type ColumnGenerator =
  | { type: "faker"; generator: string; args?: unknown[] }
  | { type: "sequence"; prefix?: string; start?: number }
  | { type: "enum"; values: unknown[] }
  | { type: "reference"; table: string; column?: string }
  | { type: "custom"; fn: (index: number, row: Record<string, unknown>) => unknown }
  | { type: "constant"; value: unknown }

export interface SeedResult {
  readonly tableName: string
  readonly rowCount: number
  readonly duration: number
}

export interface SeedPlan {
  readonly tables: SeedTablePlan[]
  readonly totalRows: number
  readonly insertionOrder: string[]
}

export interface SeedTablePlan {
  readonly tableName: string
  readonly rowCount: number
  readonly dependencies: string[]
  readonly columns: string[]
}

// ── Seeded PRNG ──────────────────────────────────────────────────────────────

export class SeededRandom {
  private state: number

  constructor(seed: number = 42) {
    this.state = seed
  }

  next(): number {
    this.state = (this.state * 1664525 + 1013904223) & 0xffffffff
    return (this.state >>> 0) / 0xffffffff
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  pick<T>(items: T[]): T {
    return items[this.nextInt(0, items.length - 1)]
  }

  shuffle<T>(items: T[]): T[] {
    const arr = [...items]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i)
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
}

// ── Faker-Style Generators ───────────────────────────────────────────────────

export class DataGenerator {
  private rng: SeededRandom

  constructor(seed?: number) {
    this.rng = new SeededRandom(seed)
  }

  firstName(): string {
    return this.rng.pick(FIRST_NAMES)
  }

  lastName(): string {
    return this.rng.pick(LAST_NAMES)
  }

  fullName(): string {
    return `${this.firstName()} ${this.lastName()}`
  }

  email(): string {
    return `${this.firstName().toLowerCase()}${this.rng.nextInt(1, 999)}@example.com`
  }

  uuid(): string {
    const hex = () => this.rng.nextInt(0, 15).toString(16)
    const seg = (n: number) => Array.from({ length: n }, hex).join("")
    return `${seg(8)}-${seg(4)}-4${seg(3)}-${hex()}${seg(3)}-${seg(12)}`
  }

  text(minWords = 3, maxWords = 15): string {
    const count = this.rng.nextInt(minWords, maxWords)
    return Array.from({ length: count }, () => this.rng.pick(WORDS)).join(" ")
  }

  sentence(): string {
    const t = this.text(5, 12)
    return t.charAt(0).toUpperCase() + t.slice(1) + "."
  }

  paragraph(): string {
    const count = this.rng.nextInt(2, 5)
    return Array.from({ length: count }, () => this.sentence()).join(" ")
  }

  integer(min = 0, max = 10000): number {
    return this.rng.nextInt(min, max)
  }

  float(min = 0, max = 1000): number {
    return Math.round((this.rng.next() * (max - min) + min) * 100) / 100
  }

  boolean(): boolean {
    return this.rng.next() > 0.5
  }

  date(startYear = 2020, endYear = 2025): string {
    const year = this.rng.nextInt(startYear, endYear)
    const month = this.rng.nextInt(1, 12)
    const day = this.rng.nextInt(1, 28)
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }

  timestamp(): string {
    return `${this.date()}T${String(this.rng.nextInt(0, 23)).padStart(2, "0")}:${String(this.rng.nextInt(0, 59)).padStart(2, "0")}:00.000Z`
  }

  url(): string {
    return `https://${this.rng.pick(["example", "test", "demo", "sample"])}.com/${this.rng.pick(WORDS)}`
  }

  enumValue<T>(values: T[]): T {
    return this.rng.pick(values)
  }

  generate(generatorName: string, args: unknown[] = []): unknown {
    const generators: Record<string, (...a: unknown[]) => unknown> = {
      firstName: () => this.firstName(),
      lastName: () => this.lastName(),
      fullName: () => this.fullName(),
      email: () => this.email(),
      uuid: () => this.uuid(),
      text: (...a: unknown[]) => this.text(a[0] as number, a[1] as number),
      sentence: () => this.sentence(),
      paragraph: () => this.paragraph(),
      integer: (...a: unknown[]) => this.integer(a[0] as number, a[1] as number),
      float: (...a: unknown[]) => this.float(a[0] as number, a[1] as number),
      boolean: () => this.boolean(),
      date: () => this.date(),
      timestamp: () => this.timestamp(),
      url: () => this.url(),
    }

    const gen = generators[generatorName]
    if (!gen) throw new Error(`Unknown generator: "${generatorName}"`)
    return gen(...args)
  }
}

// ── Seed Engine ──────────────────────────────────────────────────────────────

const SIZE_MULTIPLIERS: Record<DatasetSize, number> = {
  tiny: 1,
  small: 10,
  medium: 100,
  large: 1000,
}

export class SeedEngine {
  private generator: DataGenerator
  private generatedIds = new Map<string, unknown[]>()

  constructor(seed?: number) {
    this.generator = new DataGenerator(seed)
  }

  /**
   * Plan seed execution: determine insertion order and row counts.
   */
  plan(profile: SeedingProfile): SeedPlan {
    const tableConfigs = Object.entries(profile.tables)
    const tablePlans: SeedTablePlan[] = []
    const depGraph = new Map<string, Set<string>>()

    for (const [tableName, config] of tableConfigs) {
      const deps = new Set<string>()
      for (const colGen of Object.values(config.columns)) {
        if (colGen.type === "reference") {
          deps.add(colGen.table)
        }
      }
      depGraph.set(tableName, deps)

      const count =
        typeof config.count === "function" ? config.count(profile.size) : config.count * SIZE_MULTIPLIERS[profile.size]

      tablePlans.push({
        tableName,
        rowCount: count,
        dependencies: Array.from(deps),
        columns: Object.keys(config.columns),
      })
    }

    // Topological sort for insertion order
    const order = topologicalSort(depGraph)

    return {
      tables: tablePlans,
      totalRows: tablePlans.reduce((sum, t) => sum + t.rowCount, 0),
      insertionOrder: order,
    }
  }

  /**
   * Generate seed data for a table.
   */
  generateRows(tableName: string, config: TableSeedConfig, count: number): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = []

    for (let i = 0; i < count; i++) {
      const row: Record<string, unknown> = {}

      for (const [colName, gen] of Object.entries(config.columns)) {
        row[colName] = this.generateColumnValue(gen, i, row)
      }

      rows.push(row)
    }

    // Track generated IDs for reference resolution
    const ids = rows.map((r) => r.id ?? r[Object.keys(config.columns)[0]])
    this.generatedIds.set(tableName, ids)

    return rows
  }

  /**
   * Get all generated IDs for a table (for reference resolution).
   */
  getGeneratedIds(tableName: string): unknown[] {
    return this.generatedIds.get(tableName) ?? []
  }

  getGenerator(): DataGenerator {
    return this.generator
  }

  private generateColumnValue(gen: ColumnGenerator, index: number, row: Record<string, unknown>): unknown {
    switch (gen.type) {
      case "faker":
        return this.generator.generate(gen.generator, gen.args)
      case "sequence":
        return gen.prefix ? `${gen.prefix}${(gen.start ?? 1) + index}` : (gen.start ?? 1) + index
      case "enum":
        return this.generator.enumValue(gen.values)
      case "reference": {
        const ids = this.generatedIds.get(gen.table) ?? []
        if (ids.length === 0) return null
        return this.generator.enumValue(ids)
      }
      case "custom":
        return gen.fn(index, row)
      case "constant":
        return gen.value
    }
  }
}

// ── Topological Sort ─────────────────────────────────────────────────────────

function topologicalSort(graph: Map<string, Set<string>>): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  const visit = (node: string) => {
    if (visited.has(node)) return
    if (visiting.has(node)) return // Circular dependency, skip

    visiting.add(node)
    for (const dep of graph.get(node) ?? []) {
      visit(dep)
    }
    visiting.delete(node)
    visited.add(node)
    result.push(node)
  }

  for (const node of graph.keys()) {
    visit(node)
  }

  return result
}

// ── Built-in Data ────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  "Alice",
  "Bob",
  "Charlie",
  "Diana",
  "Eve",
  "Frank",
  "Grace",
  "Henry",
  "Ivy",
  "Jack",
  "Kate",
  "Liam",
  "Mia",
  "Noah",
  "Olivia",
  "Pete",
  "Quinn",
  "Rachel",
  "Sam",
  "Tina",
  "Uma",
  "Victor",
  "Wendy",
  "Xander",
]

const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Anderson",
  "Taylor",
  "Thomas",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Thompson",
  "White",
  "Harris",
  "Clark",
]

const WORDS = [
  "the",
  "quick",
  "brown",
  "fox",
  "jumps",
  "over",
  "lazy",
  "dog",
  "data",
  "reactive",
  "query",
  "real",
  "time",
  "stream",
  "async",
  "build",
  "deploy",
  "test",
  "schema",
  "table",
  "index",
  "column",
]
