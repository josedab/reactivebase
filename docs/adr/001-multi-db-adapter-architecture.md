# ADR-001: Multi-Database Adapter Architecture

## Status

Accepted

## Context

ReactiveBase was originally built exclusively for PostgreSQL, with Postgres-specific SQL (e.g., `$1` parameter placeholders, `RETURNING`, `jsonb`, `LISTEN/NOTIFY`) used directly throughout the codebase.

Users requested support for MySQL 8+ and SQLite (via libSQL/Turso) to enable broader adoption — particularly for edge deployments (SQLite), existing MySQL shops, and local development without Postgres.

Adding multi-database support posed several challenges:

1. SQL syntax differences (parameter placeholders, quoting, function names)
2. Feature gaps (SQLite lacks `LISTEN/NOTIFY`, MySQL lacks `RETURNING`)
3. Avoiding a leaky abstraction that penalizes Postgres users
4. Maintaining type safety across all dialects

## Decision

We introduced a **DatabaseAdapter interface** (`packages/server/src/multi-db/database-adapter.ts`) that abstracts the storage layer behind a common contract:

- **`DatabaseAdapter`** — core interface with `query()`, `execute()`, `beginTransaction()`, `ping()`, `getInfo()`, and `close()`
- **`DatabaseDialect`** — discriminated union: `"postgres" | "mysql" | "sqlite"`
- **`SQLTranslator`** — per-dialect translation of parameter placeholders, quoting, `NOW()`, `RETURNING` emulation, and type mappings
- **`TransactionHandle`** — uniform transaction API across all dialects
- **Factory functions** — `createPostgresAdapter()`, `createMySQLAdapter()`, `createSQLiteAdapter()` instantiate dialect-specific implementations
- **`DatabaseAdapterInfo`** — capability flags (`supportsReturning`, `supportsJsonb`, `supportsListenNotify`, etc.) allowing modules to degrade gracefully

Dialect-specific SQL is generated via the `SQLTranslator` rather than conditional branches in business logic. Modules that need Postgres-only features (CDC, logical replication) check capability flags and throw clear errors when used with unsupported dialects.

The migration manager also uses the adapter, translating DDL statements per dialect via `createMigrationRunner()`.

## Consequences

### Positive

- Users can adopt ReactiveBase with MySQL or SQLite without forking
- Edge deployments work with embedded SQLite (via PGlite or libSQL)
- The adapter interface is small and easy to implement for additional databases
- Feature flags prevent silent failures on unsupported operations
- Postgres users see zero performance regression (adapter is a thin passthrough)

### Negative

- SQL builder must generate dialect-aware output, increasing complexity
- Some advanced Postgres features (vector search, `tsvector`) are not available on other dialects
- Test matrix grows: each module ideally needs testing against all supported dialects
- Migration SQL generation is more complex with dialect-specific DDL differences

### Neutral

- The adapter does not attempt to abstract away all SQL; raw queries are still dialect-specific
- Third-party database support (e.g., CockroachDB, DynamoDB) would require new adapter implementations but no changes to the interface
