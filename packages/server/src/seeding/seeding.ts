/**
 * Data Seeding & Fixtures Framework.
 *
 * Declarative seed files (.seed.ts) with dependency resolution,
 * faker integration, and environment-aware profiles (dev, staging, test).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type SeedEnvironment = "dev" | "staging" | "test" | "production" | string

export interface SeedRecord {
  table: string
  data: Record<string, unknown>
}

export interface SeedDefinition {
  /** Unique seed name */
  name: string
  /** Description of what this seed creates */
  description?: string
  /** Environment(s) this seed applies to (default: all) */
  environments?: SeedEnvironment[]
  /** Seeds that must run before this one */
  dependsOn?: string[]
  /** Function that generates seed records */
  generate: (ctx: SeedContext) => SeedRecord[] | Promise<SeedRecord[]>
}

export interface SeedProfile {
  /** Profile name (e.g., "dev", "test", "staging") */
  name: string
  /** Seeds to include in this profile */
  seeds: string[]
  /** Environment this profile targets */
  environment: SeedEnvironment
  /** Whether to truncate tables before seeding */
  truncateFirst?: boolean
}

export interface SeedContext {
  /** Current environment */
  environment: SeedEnvironment
  /** Faker-like data generators */
  fake: FakeDataGenerators
  /** Reference a previously seeded record by seed name and index */
  ref: (seedName: string, index: number, field?: string) => unknown
  /** Generate a unique ID */
  id: () => string
  /** Current timestamp */
  now: () => Date
}

export interface FakeDataGenerators {
  firstName: () => string
  lastName: () => string
  fullName: () => string
  email: () => string
  username: () => string
  phone: () => string
  uuid: () => string
  integer: (min?: number, max?: number) => number
  float: (min?: number, max?: number) => number
  boolean: () => boolean
  date: (start?: Date, end?: Date) => Date
  pastDate: () => Date
  futureDate: () => Date
  paragraph: () => string
  sentence: () => string
  word: () => string
  url: () => string
  imageUrl: (width?: number, height?: number) => string
  color: () => string
  company: () => string
  pick: <T>(items: T[]) => T
  arrayOf: <T>(generator: () => T, count: number) => T[]
}

export interface SeedExecutionResult {
  /** Seeds that were executed */
  executed: string[]
  /** Records inserted per table */
  recordsByTable: Record<string, number>
  /** Total records inserted */
  totalRecords: number
  /** Execution time in ms */
  durationMs: number
  /** Any errors encountered */
  errors: Array<{ seed: string; error: string }>
}

export interface SeedStatus {
  /** All registered seeds */
  seeds: Array<{
    name: string
    description?: string
    environments: SeedEnvironment[]
    dependsOn: string[]
    applied: boolean
    appliedAt?: number
  }>
  /** Currently active profile */
  activeProfile?: string
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class SeedError extends Error {
  readonly code = "SEED_ERROR"

  constructor(message: string) {
    super(message)
    this.name = "SeedError"
  }
}

export class SeedDependencyError extends Error {
  readonly code = "SEED_DEPENDENCY_ERROR"

  constructor(
    public readonly seedName: string,
    public readonly missingDependency: string,
  ) {
    super(`Seed "${seedName}" depends on "${missingDependency}" which is not registered`)
    this.name = "SeedDependencyError"
  }
}

export class SeedCycleError extends Error {
  readonly code = "SEED_CYCLE_ERROR"

  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected in seeds: ${cycle.join(" → ")}`)
    this.name = "SeedCycleError"
  }
}

// ─── Built-in Fake Data Generators ──────────────────────────────────────────

const FIRST_NAMES = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank", "Ivy", "Jack", "Karen", "Leo", "Mia", "Nate", "Olivia", "Pete", "Quinn", "Rosa", "Sam", "Tina"]
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson"]
const WORDS = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do", "eiusmod", "tempor", "incididunt"]
const COMPANIES = ["Acme Corp", "GlobalTech", "Innovate Inc", "DataFlow", "CloudNine", "ByteWorks", "PixelPerfect", "CodeCraft"]

let idCounter = 0

function createFakeGenerators(): FakeDataGenerators {
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

  return {
    firstName: () => pick(FIRST_NAMES),
    lastName: () => pick(LAST_NAMES),
    fullName: () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    email: () => `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}${Math.floor(Math.random() * 100)}@example.com`,
    username: () => `${pick(FIRST_NAMES).toLowerCase()}${Math.floor(Math.random() * 1000)}`,
    phone: () => `+1${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    uuid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(["8", "9", "a", "b"])}${hex(3)}-${hex(12)}`,
    integer: (min = 0, max = 1000) => Math.floor(Math.random() * (max - min + 1)) + min,
    float: (min = 0, max = 1000) => Math.random() * (max - min) + min,
    boolean: () => Math.random() > 0.5,
    date: (start?: Date, end?: Date) => {
      const s = start?.getTime() ?? Date.now() - 365 * 24 * 60 * 60 * 1000
      const e = end?.getTime() ?? Date.now()
      return new Date(s + Math.random() * (e - s))
    },
    pastDate: () => new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000),
    futureDate: () => new Date(Date.now() + Math.random() * 365 * 24 * 60 * 60 * 1000),
    paragraph: () => Array.from({ length: 3 + Math.floor(Math.random() * 5) }, () => pick(WORDS)).join(" ") + ".",
    sentence: () => {
      const words = Array.from({ length: 5 + Math.floor(Math.random() * 10) }, () => pick(WORDS))
      words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1)
      return words.join(" ") + "."
    },
    word: () => pick(WORDS),
    url: () => `https://${pick(WORDS)}.example.com/${pick(WORDS)}`,
    imageUrl: (w = 200, h = 200) => `https://picsum.photos/${w}/${h}?random=${Math.floor(Math.random() * 1000)}`,
    color: () => `#${hex(6)}`,
    company: () => pick(COMPANIES),
    pick,
    arrayOf: <T>(gen: () => T, count: number): T[] => Array.from({ length: count }, gen),
  }
}

function hex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("")
}

// ─── Seed Registry ──────────────────────────────────────────────────────────

/**
 * Manages seed definitions, resolves dependencies, and executes seeds.
 */
export class SeedRegistry {
  private seeds = new Map<string, SeedDefinition>()
  private profiles = new Map<string, SeedProfile>()
  private appliedSeeds = new Map<string, number>()
  private seededRecords = new Map<string, SeedRecord[]>()

  /**
   * Register a seed definition.
   */
  register(def: SeedDefinition): void {
    if (!def.name || def.name.trim().length === 0) {
      throw new SeedError("Seed name is required")
    }
    this.seeds.set(def.name, def)
  }

  /**
   * Register a seed profile.
   */
  registerProfile(profile: SeedProfile): void {
    this.profiles.set(profile.name, profile)
  }

  /**
   * Resolve dependency order using topological sort.
   */
  resolveDependencyOrder(seedNames: string[]): string[] {
    // Validate all seeds exist
    for (const name of seedNames) {
      if (!this.seeds.has(name)) {
        throw new SeedError(`Seed "${name}" is not registered`)
      }
    }

    // Validate dependencies exist
    for (const name of seedNames) {
      const seed = this.seeds.get(name)!
      for (const dep of seed.dependsOn ?? []) {
        if (!this.seeds.has(dep)) {
          throw new SeedDependencyError(name, dep)
        }
      }
    }

    // Topological sort
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const order: string[] = []

    const visit = (name: string): void => {
      if (visited.has(name)) return
      if (visiting.has(name)) {
        throw new SeedCycleError([...visiting, name])
      }

      visiting.add(name)
      const seed = this.seeds.get(name)
      if (seed?.dependsOn) {
        for (const dep of seed.dependsOn) {
          if (seedNames.includes(dep) || this.seeds.has(dep)) {
            visit(dep)
          }
        }
      }
      visiting.delete(name)
      visited.add(name)
      order.push(name)
    }

    for (const name of seedNames) {
      visit(name)
    }

    return order
  }

  /**
   * Execute seeds for a given environment.
   */
  async execute(
    environment: SeedEnvironment,
    seedNames?: string[],
  ): Promise<SeedExecutionResult> {
    const startTime = performance.now()
    const errors: Array<{ seed: string; error: string }> = []
    const recordsByTable: Record<string, number> = {}
    let totalRecords = 0

    // Determine which seeds to run
    const names = seedNames ?? Array.from(this.seeds.keys())
    const filtered = names.filter((name) => {
      const seed = this.seeds.get(name)
      if (!seed) return false
      if (seed.environments && !seed.environments.includes(environment)) return false
      return true
    })

    // Resolve dependency order
    const ordered = this.resolveDependencyOrder(filtered)

    // Create context
    const fake = createFakeGenerators()
    const ctx: SeedContext = {
      environment,
      fake,
      ref: (seedName: string, index: number, field?: string) => {
        const records = this.seededRecords.get(seedName)
        if (!records || !records[index]) {
          throw new SeedError(`Cannot ref seed "${seedName}" index ${index}: not yet seeded`)
        }
        const record = records[index]
        return field ? record.data[field] : record.data
      },
      id: () => `seed_${++idCounter}_${Date.now().toString(36)}`,
      now: () => new Date(),
    }

    // Execute in order
    const executed: string[] = []
    for (const name of ordered) {
      const seed = this.seeds.get(name)!
      try {
        const records = await seed.generate(ctx)
        this.seededRecords.set(name, records)
        this.appliedSeeds.set(name, Date.now())
        executed.push(name)

        for (const record of records) {
          recordsByTable[record.table] = (recordsByTable[record.table] ?? 0) + 1
          totalRecords++
        }
      } catch (error) {
        errors.push({
          seed: name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      executed,
      recordsByTable,
      totalRecords,
      durationMs: performance.now() - startTime,
      errors,
    }
  }

  /**
   * Execute a named profile.
   */
  async executeProfile(profileName: string): Promise<SeedExecutionResult> {
    const profile = this.profiles.get(profileName)
    if (!profile) {
      throw new SeedError(`Seed profile "${profileName}" not found`)
    }
    return this.execute(profile.environment, profile.seeds)
  }

  /**
   * Reset all seed state.
   */
  reset(): void {
    this.appliedSeeds.clear()
    this.seededRecords.clear()
    idCounter = 0
  }

  /**
   * Get current seed status.
   */
  getStatus(): SeedStatus {
    return {
      seeds: Array.from(this.seeds.values()).map((s) => ({
        name: s.name,
        description: s.description,
        environments: s.environments ?? [],
        dependsOn: s.dependsOn ?? [],
        applied: this.appliedSeeds.has(s.name),
        appliedAt: this.appliedSeeds.get(s.name),
      })),
    }
  }

  /**
   * Get seeded records by seed name.
   */
  getRecords(seedName: string): SeedRecord[] {
    return this.seededRecords.get(seedName) ?? []
  }

  get size(): number {
    return this.seeds.size
  }
}

// ─── DSL Helpers ─────────────────────────────────────────────────────────────

/**
 * Define a seed.
 */
export function defineSeed(
  name: string,
  config: Omit<SeedDefinition, "name">,
): SeedDefinition {
  return { name, ...config }
}

/**
 * Define a seed profile.
 */
export function defineSeedProfile(profile: SeedProfile): SeedProfile {
  return { ...profile }
}

/**
 * Create a seed registry.
 */
export function createSeedRegistry(): SeedRegistry {
  return new SeedRegistry()
}

// ─── SQL for Seed Tracking ──────────────────────────────────────────────────

export function generateSeedTrackingTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_seeds (
  name TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  records_count INTEGER NOT NULL DEFAULT 0,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`
}
