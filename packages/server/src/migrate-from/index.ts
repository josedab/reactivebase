export { parsePrismaSchema, generateReactiveBaseSchema, convertPrismaToReactiveBase } from "./prisma.js"
export type { PrismaModel, PrismaField, PrismaIndex } from "./prisma.js"

export { parseDrizzleSchema, generateReactiveBaseFromDrizzle, convertDrizzleToReactiveBase } from "./drizzle.js"
export type { DrizzleTable, DrizzleColumn } from "./drizzle.js"

// Enhanced Migration Wizard
export {
  MigrationWizard,
  discoverTrpcRoutes,
  discoverExpressRoutes,
  mapPrismaType,
  mapDrizzleType,
  analyzeFeatureGaps,
} from "./migration-wizard.js"
export type {
  ProjectAnalysis,
  MigrationTable,
  MigrationField,
  MigrationRelation,
  DiscoveredRoute,
  MigrationWarning,
  FeatureGap,
  MigrationPlan,
  MigrationStep,
  MigrationDiff,
  DiffChange,
} from "./migration-wizard.js"
