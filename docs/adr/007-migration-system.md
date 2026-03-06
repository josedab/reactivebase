# ADR-007: Migration System Design

## Status

Accepted

## Context

ReactiveBase needs a migration system that:

1. Tracks schema changes over time with reversible migrations
2. Supports the multi-database adapter architecture (ADR-001) — generating dialect-specific DDL
3. Can auto-generate migrations by diffing the current schema definition against the database state
4. Integrates with the CLI (`reactivebase migrate`) and the dev server (auto-apply on startup)

Existing migration tools (Prisma Migrate, Drizzle Kit) are tightly coupled to their respective ORMs and cannot be reused directly.

## Decision

We implement a custom migration system in `packages/server/src/migrations/`:

- **Schema diffing** — the `SchemaDiffer` compares the TypeScript schema definition (`defineSchema()`) against the current database schema (queried from `information_schema`) and produces a list of `SchemaChange` operations (add table, add column, alter column, drop column, add index, etc.)
- **Migration generation** — `MigrationGenerator` converts `SchemaChange` operations into SQL DDL statements, using the `SQLTranslator` from the database adapter to produce dialect-correct output
- **Migration files** — stored as timestamped SQL files (`<timestamp>_<description>.sql`) with `-- UP` and `-- DOWN` sections
- **Migration runner** — `MigrationRunner` applies pending migrations in order, tracks applied migrations in a `_reactivebase_migrations` table, and supports rollback
- **Dev mode auto-apply** — in development, the dev server auto-generates and applies migrations on schema changes (can be disabled)

## Consequences

### Positive

- Schema diffing reduces boilerplate — developers modify the schema definition and migrations are auto-generated
- Dialect-aware DDL generation ensures migrations work across Postgres, MySQL, and SQLite
- Timestamped migration files provide a clear audit trail and support team collaboration
- The `-- DOWN` section enables rollbacks for each migration

### Negative

- Auto-generated migrations may need manual adjustment for complex changes (data migrations, column renames)
- Schema diffing cannot detect renames — they appear as drop + add, requiring manual correction
- The `_reactivebase_migrations` tracking table adds a framework-specific artifact to the database
