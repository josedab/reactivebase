# Error Codes Reference

All custom error classes across `@reactivebase/*` packages, grouped by module.

## Core Errors

These errors are defined in `packages/server/src/errors.ts` and form the foundation of ReactiveBase's error hierarchy.

| Error Class                 | Code                      | Message Template                                                              |
| --------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `ReactiveBaseError`         | (varies)                  | Base error class for all ReactiveBase domain errors                           |
| `ReadOnlyError`             | `READ_ONLY_VIOLATION`     | Cannot perform write operations in a read-only query. Use a mutation instead. |
| `RecordNotFoundError`       | `RECORD_NOT_FOUND`        | Record not found in "${tableName}" with id "${id}"                            |
| `FunctionNotFoundError`     | `FUNCTION_NOT_FOUND`      | Query function not found: "${name}"                                           |
| `NotQueryFunctionError`     | `NOT_QUERY_FUNCTION`      | "${name}" is not a query function                                             |
| `CircularDependencyError`   | `CIRCULAR_DEPENDENCY`     | Circular query dependency detected: ${cycle}                                  |
| `EmitOutsideMutationError`  | `EMIT_OUTSIDE_MUTATION`   | ctx.emit() is only available inside mutation handlers                         |
| `QueryContextRequiredError` | `QUERY_CONTEXT_REQUIRED`  | ctx.query() requires a query resolution context                               |
| `InvalidMessageError`       | `INVALID_MESSAGE`         | Invalid message: ${detail}                                                    |
| `SchemaValidationError`     | `SCHEMA_VALIDATION_ERROR` | (dynamic message)                                                             |

## GraphQL Package (`@reactivebase/graphql`)

| Error Class           | Module            | Message Template  |
| --------------------- | ----------------- | ----------------- |
| `GraphQLGatewayError` | `graphql-gateway` | (dynamic message) |

## Edge Package (`@reactivebase/edge`)

| Error Class      | Module | Message Template                                                      |
| ---------------- | ------ | --------------------------------------------------------------------- |
| `EdgeQueryError` | `edge` | Query "${queryName}" failed: ${status} (includes statusCode and body) |

## Server Package (`@reactivebase/server`)

| Error Class              | Module              | Message Template                                                                 |
| ------------------------ | ------------------- | -------------------------------------------------------------------------------- |
| `AdvancedRateLimitError` | `rate-limiting`     | Rate limit exceeded (rule: "${rule}", scope: ${scope}). Retry after ${Math.ce... |
| `AnalyticsError`         | `analytics`         | (dynamic message)                                                                |
| `AuthDebugError`         | `auth-debugger`     | (dynamic message)                                                                |
| `AuthenticationError`    | `auth`              | (dynamic message)                                                                |
| `AuthorizationError`     | `auth`              | (dynamic message)                                                                |
| `AuthzError`             | `authz`             | (dynamic message)                                                                |
| `BackpressureError`      | `smart-pool`        | Database backpressure: ${pendingCount} pending queries (max: ${maxPending}). ... |
| `BranchingError`         | `branching`         | (dynamic message)                                                                |
| `CloudError`             | `cloud`             | (dynamic message)                                                                |
| `CrdtError`              | `crdt`              | (dynamic message)                                                                |
| `DatabaseAdapterError`   | `multi-db`          | (dynamic message)                                                                |
| `DatabaseManagerError`   | `cloud-platform`    | (dynamic message)                                                                |
| `EncryptionError`        | `encryption`        | (dynamic message)                                                                |
| `EventSourcingError`     | `event-sourcing`    | (dynamic message)                                                                |
| `FederationError`        | `multi-db`          | (dynamic message)                                                                |
| `MediaPipelineError`     | `media-pipeline`    | (dynamic message)                                                                |
| `MultiplayerError`       | `multiplayer`       | (dynamic message)                                                                |
| `NeonBranchingError`     | `branching`         | (dynamic message)                                                                |
| `OutboxError`            | `transaction`       | (dynamic message)                                                                |
| `PlaygroundError`        | `playground`        | (dynamic message)                                                                |
| `PluginMarketplaceError` | `plugins`           | (dynamic message)                                                                |
| `PoolExhaustedError`     | `smart-pool`        | Connection pool exhausted: ${activeConnections}/${maxConnections} connections... |
| `PreviewError`           | `branching`         | (dynamic message)                                                                |
| `ProcedureCompileError`  | `stored-procedures` | Compile error in procedure "${procedureName}": ${message}                        |
| `ProvisioningError`      | `cloud-platform`    | (dynamic message)                                                                |
| `RateLimitError`         | `validation`        | Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s              |
| `SafeMigrationError`     | `safe-migrations`   | (dynamic message)                                                                |
| `SchemaRegistryError`    | `schema-registry`   | (dynamic message)                                                                |
| `SearchError`            | `full-text-search`  | (dynamic message)                                                                |
| `SeedCycleError`         | `seeding`           | Circular dependency detected in seeds: ${cycle.join(" → ")}                      |
| `SeedDependencyError`    | `seeding`           | Seed "${seedName}" depends on "${missingDependency}" which is not registered     |
| `SeedError`              | `seeding`           | (dynamic message)                                                                |
| `UniversalSdkError`      | `universal-sdk`     | (dynamic message)                                                                |
| `UnsafeMigrationError`   | `safe-migrations`   | (dynamic message)                                                                |
| `ValidationError`        | `validation`        | (dynamic message)                                                                |
| `VaultError`             | `encryption`        | (dynamic message)                                                                |
| `WebhookDeliveryError`   | `webhooks`          | (dynamic message)                                                                |
| `WorkflowCancelledError` | `workflow`          | Workflow ${workflowId} was cancelled                                             |
| `WorkflowError`          | `workflow`          | (dynamic message)                                                                |
| `WorkflowStepError`      | `workflow`          | Step "${stepName}" failed: ${message}                                            |
| `WorkflowStudioError`    | `workflow-studio`   | (dynamic message)                                                                |
| `WorkflowWaitingError`   | `workflow`          | Workflow waiting for event: ${eventName}                                         |
| `ZanzibarError`          | `zanzibar`          | (dynamic message)                                                                |

---

## Details by Module (Server Package)

### analytics

#### `AnalyticsError`

- **Source**: `packages/server/src/analytics/analytics.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify your analytics pipeline configuration (aggregations, time windows). Ensure the target tables exist and have the expected columns for the metrics you're collecting.

### auth

#### `AuthenticationError`

- **Source**: `packages/server/src/auth/auth.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the JWT token is valid and not expired. Check that your auth provider configuration (secret, issuer, audience) in `defineConfig()` matches the token issuer's settings.

#### `AuthorizationError`

- **Source**: `packages/server/src/auth/auth.ts`
- **Message**: (dynamic message)
- **Resolution**: Ensure the authenticated user has the required role or permission. Review your `allow()` / `deny()` rules in the function definition and verify the user's claims include the expected roles.

### auth-debugger

#### `AuthDebugError`

- **Source**: `packages/server/src/auth-debugger/auth-debugger.ts`
- **Message**: (dynamic message)
- **Resolution**: The auth debugger encountered an issue tracing the auth pipeline. Run with verbose logging enabled (`authDebug: true` in config) to see which middleware step failed.

### authz

#### `AuthzError`

- **Source**: `packages/server/src/authz/authz.ts`
- **Message**: (dynamic message)
- **Resolution**: Check that the RBAC roles and permissions are defined correctly. Verify the user's token includes the required claims and that `allow()` rules match the function being called.

### branching

#### `BranchingError`

- **Source**: `packages/server/src/branching/branching.ts`
- **Message**: (dynamic message)
- **Resolution**: Ensure the source branch exists and the database connection is available. Check that the branch name doesn't conflict with an existing branch and that you have sufficient permissions.

#### `PreviewError`

- **Source**: `packages/server/src/branching/github-action.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the GitHub PR configuration and that the preview environment quota hasn't been exceeded. Check `maxPreviews` in your branching config and ensure the PR number is valid.

#### `NeonBranchingError`

- **Source**: `packages/server/src/branching/neon-branching.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify your Neon API key and project ID are correct. Ensure the parent branch exists and the Neon project has available compute capacity for a new branch.

### cloud

#### `CloudError`

- **Source**: `packages/server/src/cloud/cloud.ts`
- **Message**: (dynamic message)
- **Resolution**: Check your cloud API credentials and network connectivity. Verify the project ID exists and that your account has the required permissions for the operation.

### cloud-platform

#### `ProvisioningError`

- **Source**: `packages/server/src/cloud-platform/one-click-provisioner.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the provisioning pipeline step that failed. Common issues: missing infrastructure permissions, resource quotas exceeded, or invalid deploy manifest configuration.

#### `DatabaseManagerError`

- **Source**: `packages/server/src/cloud-platform/one-click-provisioner.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the database connection string and credentials. Ensure the target Postgres instance is reachable and the user has CREATE/ALTER privileges.

### crdt

#### `CrdtError`

- **Source**: `packages/server/src/crdt/crdt.ts`
- **Message**: (dynamic message)
- **Resolution**: Check that the CRDT document type matches the expected schema. Ensure operations are applied to the correct document ID and that concurrent edits don't violate type constraints.

### edge-query

#### `EdgeQueryError`

- **Source**: `packages/server/src/edge-query/edge-query.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the edge query cache configuration and that the upstream server is reachable. Check that the query name matches a registered server query and the serialization format is compatible.
- **Note**: This is a server-side edge query error, distinct from `EdgeQueryError` in `@reactivebase/edge`.

### encryption

#### `EncryptionError`

- **Source**: `packages/server/src/encryption/encryption.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the encryption key is the correct length for the algorithm (e.g., 32 bytes for AES-256). Ensure the key hasn't been rotated without re-encrypting existing data.

#### `VaultError`

- **Source**: `packages/server/src/encryption/vault-provider.ts`
- **Message**: (dynamic message)
- **Resolution**: Check your vault/KMS provider credentials and connectivity. Ensure the key ID exists in the provider and your IAM permissions allow encrypt/decrypt operations.

### event-sourcing

#### `EventSourcingError`

- **Source**: `packages/server/src/event-sourcing/event-sourcing.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the event store table exists and the event schema matches. Check for version conflicts if using optimistic concurrency, and ensure projections are registered before replaying events.

### full-text-search

#### `SearchError`

- **Source**: `packages/server/src/full-text-search/full-text-search.ts`
- **Message**: (dynamic message)
- **Resolution**: Ensure the search index has been created for the target table. Verify the search query syntax is valid and that the `tsvector` column exists on the table.

### media-pipeline

#### `MediaPipelineError`

- **Source**: `packages/server/src/media-pipeline/media-pipeline.ts`
- **Message**: (dynamic message)
- **Resolution**: Check that the input file format is supported and the storage backend is accessible. Verify pipeline step configuration (resize dimensions, output format) and that temporary storage has sufficient space.

### multi-db

#### `DatabaseAdapterError`

- **Source**: `packages/server/src/multi-db/database-adapter.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the database adapter type matches your database engine. Check the connection string format and credentials, and ensure the target database accepts connections.

#### `FederationError`

- **Source**: `packages/server/src/multi-db/multi-db.ts`
- **Message**: (dynamic message)
- **Resolution**: Ensure all federated database nodes are reachable. Check that table sharding/routing rules are consistent and that cross-database references use the correct adapter identifiers.

### multiplayer

#### `MultiplayerError`

- **Source**: `packages/server/src/multiplayer/multiplayer.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the room ID exists and the user has permission to join. Check that the WebSocket transport is connected and the multiplayer document schema matches the expected format.

### playground

#### `PlaygroundError`

- **Source**: `packages/server/src/playground/playground.ts`
- **Message**: (dynamic message)
- **Resolution**: Ensure the SQL playground is enabled in your server config. Verify the query syntax is valid SQL and that the connected database user has permission to execute the statement.

### plugins

#### `PluginMarketplaceError`

- **Source**: `packages/server/src/plugins/marketplace.ts`
- **Message**: (dynamic message)
- **Resolution**: Check network connectivity to the plugin registry. Verify the plugin name and version exist in the marketplace, and that your project meets the plugin's peer dependency requirements.

### rate-limiting

#### `AdvancedRateLimitError`

- **Source**: `packages/server/src/rate-limiting/rate-limiting.ts`
- **Message**: Rate limit exceeded (rule: "${rule}", scope: ${scope}). Retry after ${Math.ceil(retryAfterMs / 1000)}s
- **Resolution**: Wait for the `retryAfter` duration before retrying. To adjust limits, update the rate limit rules in your server config. Check the `scope` value to understand which limit was hit (per-user, per-IP, global).

### safe-migrations

#### `SafeMigrationError`

- **Source**: `packages/server/src/safe-migrations/safe-migrations.ts`
- **Message**: (dynamic message)
- **Resolution**: Review the migration plan for potentially destructive operations. Use `--allow-destructive` to override safety checks if the data loss is intentional, or revise the migration to be non-destructive.

#### `UnsafeMigrationError`

- **Source**: `packages/server/src/safe-migrations/safe-migrations.ts`
- **Message**: (dynamic message)
- **Resolution**: The migration contains an unsafe operation (e.g., dropping a column with data). Add a separate migration to back up the data first, or use `--allow-destructive` if data loss is acceptable.

### schema-registry

#### `SchemaRegistryError`

- **Source**: `packages/server/src/schema-registry/schema-registry.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the schema version exists in the registry. Check for conflicting schema names and ensure the schema definition passes validation before registration.

### seeding

#### `SeedError`

- **Source**: `packages/server/src/seeding/seeding.ts`
- **Message**: (dynamic message)
- **Resolution**: Check that seed data conforms to the table schema and required fields are populated. Ensure foreign key references point to existing records or seeds that run first.

#### `SeedDependencyError`

- **Source**: `packages/server/src/seeding/seeding.ts`
- **Message**: Seed "${seedName}" depends on "${missingDependency}" which is not registered
- **Resolution**: Register the missing seed dependency before the dependent seed. Verify the dependency name matches exactly (case-sensitive) and that it's included in your seed configuration.

#### `SeedCycleError`

- **Source**: `packages/server/src/seeding/seeding.ts`
- **Message**: Circular dependency detected in seeds: ${cycle.join(" → ")}
- **Resolution**: Break the circular dependency by removing one `dependsOn` edge in the cycle. Consider merging the cyclically-dependent seeds into a single seed, or use nullable foreign keys to decouple them.

### smart-pool

#### `BackpressureError`

- **Source**: `packages/server/src/smart-pool/smart-pool.ts`
- **Message**: Database backpressure: ${pendingCount} pending queries (max: ${maxPending}). Try again later.
- **Resolution**: Reduce concurrent query load or increase `maxPending` in pool config. Investigate slow queries that may be holding connections. Consider adding query timeouts or optimizing expensive queries.

#### `PoolExhaustedError`

- **Source**: `packages/server/src/smart-pool/smart-pool.ts`
- **Message**: Connection pool exhausted: ${activeConnections}/${maxConnections} connections in use
- **Resolution**: Increase `poolSize` in your database config, or reduce long-held connections. Check for connection leaks (missing `release()` calls) and ensure transactions are committed/rolled back promptly.

### stored-procedures

#### `ProcedureCompileError`

- **Source**: `packages/server/src/stored-procedures/stored-procedures.ts`
- **Message**: Compile error in procedure "${procedureName}": ${message}
- **Resolution**: Review the procedure's SQL body for syntax errors. Verify that referenced tables, columns, and types exist in the current schema. Test the SQL directly against Postgres to isolate the issue.

### transaction

#### `OutboxError`

- **Source**: `packages/server/src/transaction/outbox.ts`
- **Message**: (dynamic message)
- **Resolution**: Check that the outbox table exists and is writable. Verify the outbox processor is running and that messages aren't stuck in a failed state. Inspect the dead-letter queue for unprocessable entries.

### universal-sdk

#### `UniversalSdkError`

- **Source**: `packages/server/src/universal-sdk/universal-sdk.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the SDK platform target (browser, Node, edge) matches your runtime. Check that the server URL is correct and the SDK version is compatible with the server version.

### validation

#### `ValidationError`

- **Source**: `packages/server/src/validation/args-validation.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the mutation/query arguments against the expected schema. The error message indicates which field failed validation. Use `v.*` validators in your function definition to see the expected types.

#### `RateLimitError`

- **Source**: `packages/server/src/validation/rate-limit.ts`
- **Message**: Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s
- **Resolution**: Wait the indicated duration before retrying. To adjust the limit, modify the `rateLimit` option in your function definition (e.g., `rateLimit: { max: 100, windowMs: 60000 }`).

### webhooks

#### `WebhookDeliveryError`

- **Source**: `packages/server/src/webhooks/delivery-queue.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the webhook endpoint URL is reachable and returns a 2xx status. Check the HMAC signature configuration if receiving 401/403 errors. Review the delivery queue for retry attempts and failure reasons.

### workflow

#### `WorkflowError`

- **Source**: `packages/server/src/workflow/workflow.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the workflow definition for invalid step configurations. Verify all referenced steps exist and that input/output types match between connected steps.

#### `WorkflowStepError`

- **Source**: `packages/server/src/workflow/workflow.ts`
- **Message**: Step "${stepName}" failed: ${message}
- **Resolution**: Inspect the inner error message for the specific step failure. Check the step handler's input arguments and ensure external dependencies (APIs, databases) are available.

#### `WorkflowWaitingError`

- **Source**: `packages/server/src/workflow/workflow.ts`
- **Message**: Workflow waiting for event: ${eventName}
- **Resolution**: This is informational — the workflow is paused waiting for an external event. Send the expected event using `workflow.sendEvent(eventName, payload)` to resume execution.

#### `WorkflowCancelledError`

- **Source**: `packages/server/src/workflow/workflow.ts`
- **Message**: Workflow ${workflowId} was cancelled
- **Resolution**: The workflow was explicitly cancelled via `workflow.cancel()`. If this was unintentional, restart the workflow. Check if a timeout or external system triggered the cancellation.

### workflow-studio

#### `WorkflowStudioError`

- **Source**: `packages/server/src/workflow-studio/workflow-studio.ts`
- **Message**: (dynamic message)
- **Resolution**: Verify the workflow studio server is running and the workflow definition is valid JSON. Check that referenced workflow IDs exist and the visual graph data hasn't been corrupted.

### zanzibar

#### `ZanzibarError`

- **Source**: `packages/server/src/zanzibar/zanzibar.ts`
- **Message**: (dynamic message)
- **Resolution**: Review your Zanzibar relationship tuples and permission model. Verify that the namespace, relation, and object IDs are valid, and that the permission check query references existing tuple definitions.
