# Error Codes Reference

All custom error classes in `@reactivebase/server`, grouped by module.

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
| `EdgeQueryError`         | `edge-query`        | (dynamic message)                                                                |
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

## Details by Module

### analytics

#### `AnalyticsError`

- **Source**: `packages/server/src/analytics/analytics.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the analytics module documentation for configuration and usage details.

### auth

#### `AuthenticationError`

- **Source**: `packages/server/src/auth/auth.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the auth module documentation for configuration and usage details.

#### `AuthorizationError`

- **Source**: `packages/server/src/auth/auth.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the auth module documentation for configuration and usage details.

### auth-debugger

#### `AuthDebugError`

- **Source**: `packages/server/src/auth-debugger/auth-debugger.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the auth-debugger module documentation for configuration and usage details.

### authz

#### `AuthzError`

- **Source**: `packages/server/src/authz/authz.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the authz module documentation for configuration and usage details.

### branching

#### `BranchingError`

- **Source**: `packages/server/src/branching/branching.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the branching module documentation for configuration and usage details.

#### `PreviewError`

- **Source**: `packages/server/src/branching/github-action.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the branching module documentation for configuration and usage details.

#### `NeonBranchingError`

- **Source**: `packages/server/src/branching/neon-branching.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the branching module documentation for configuration and usage details.

### cloud

#### `CloudError`

- **Source**: `packages/server/src/cloud/cloud.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the cloud module documentation for configuration and usage details.

### cloud-platform

#### `ProvisioningError`

- **Source**: `packages/server/src/cloud-platform/one-click-provisioner.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the cloud-platform module documentation for configuration and usage details.

#### `DatabaseManagerError`

- **Source**: `packages/server/src/cloud-platform/one-click-provisioner.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the cloud-platform module documentation for configuration and usage details.

### crdt

#### `CrdtError`

- **Source**: `packages/server/src/crdt/crdt.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the crdt module documentation for configuration and usage details.

### edge-query

#### `EdgeQueryError`

- **Source**: `packages/server/src/edge-query/edge-query.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the edge-query module documentation for configuration and usage details.

### encryption

#### `EncryptionError`

- **Source**: `packages/server/src/encryption/encryption.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the encryption module documentation for configuration and usage details.

#### `VaultError`

- **Source**: `packages/server/src/encryption/vault-provider.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the encryption module documentation for configuration and usage details.

### event-sourcing

#### `EventSourcingError`

- **Source**: `packages/server/src/event-sourcing/event-sourcing.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the event-sourcing module documentation for configuration and usage details.

### full-text-search

#### `SearchError`

- **Source**: `packages/server/src/full-text-search/full-text-search.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the full-text-search module documentation for configuration and usage details.

### media-pipeline

#### `MediaPipelineError`

- **Source**: `packages/server/src/media-pipeline/media-pipeline.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the media-pipeline module documentation for configuration and usage details.

### multi-db

#### `DatabaseAdapterError`

- **Source**: `packages/server/src/multi-db/database-adapter.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the multi-db module documentation for configuration and usage details.

#### `FederationError`

- **Source**: `packages/server/src/multi-db/multi-db.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the multi-db module documentation for configuration and usage details.

### multiplayer

#### `MultiplayerError`

- **Source**: `packages/server/src/multiplayer/multiplayer.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the multiplayer module documentation for configuration and usage details.

### playground

#### `PlaygroundError`

- **Source**: `packages/server/src/playground/playground.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the playground module documentation for configuration and usage details.

### plugins

#### `PluginMarketplaceError`

- **Source**: `packages/server/src/plugins/marketplace.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the plugins module documentation for configuration and usage details.

### rate-limiting

#### `AdvancedRateLimitError`

- **Source**: `packages/server/src/rate-limiting/rate-limiting.ts`
- **Message**: Rate limit exceeded (rule: "${rule}", scope: ${scope}). Retry after ${Math.ceil(retryAfterMs / 1000)}s
- **Resolution**: Check the rate-limiting module documentation for configuration and usage details.

### safe-migrations

#### `SafeMigrationError`

- **Source**: `packages/server/src/safe-migrations/safe-migrations.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the safe-migrations module documentation for configuration and usage details.

#### `UnsafeMigrationError`

- **Source**: `packages/server/src/safe-migrations/safe-migrations.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the safe-migrations module documentation for configuration and usage details.

### schema-registry

#### `SchemaRegistryError`

- **Source**: `packages/server/src/schema-registry/schema-registry.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the schema-registry module documentation for configuration and usage details.

### seeding

#### `SeedError`

- **Source**: `packages/server/src/seeding/seeding.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the seeding module documentation for configuration and usage details.

#### `SeedDependencyError`

- **Source**: `packages/server/src/seeding/seeding.ts`
- **Message**: Seed "${seedName}" depends on "${missingDependency}" which is not registered
- **Resolution**: Check the seeding module documentation for configuration and usage details.

#### `SeedCycleError`

- **Source**: `packages/server/src/seeding/seeding.ts`
- **Message**: Circular dependency detected in seeds: ${cycle.join(" → ")}
- **Resolution**: Check the seeding module documentation for configuration and usage details.

### smart-pool

#### `BackpressureError`

- **Source**: `packages/server/src/smart-pool/smart-pool.ts`
- **Message**: Database backpressure: ${pendingCount} pending queries (max: ${maxPending}). Try again later.
- **Resolution**: Check the smart-pool module documentation for configuration and usage details.

#### `PoolExhaustedError`

- **Source**: `packages/server/src/smart-pool/smart-pool.ts`
- **Message**: Connection pool exhausted: ${activeConnections}/${maxConnections} connections in use
- **Resolution**: Check the smart-pool module documentation for configuration and usage details.

### stored-procedures

#### `ProcedureCompileError`

- **Source**: `packages/server/src/stored-procedures/stored-procedures.ts`
- **Message**: Compile error in procedure "${procedureName}": ${message}
- **Resolution**: Check the stored-procedures module documentation for configuration and usage details.

### transaction

#### `OutboxError`

- **Source**: `packages/server/src/transaction/outbox.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the transaction module documentation for configuration and usage details.

### universal-sdk

#### `UniversalSdkError`

- **Source**: `packages/server/src/universal-sdk/universal-sdk.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the universal-sdk module documentation for configuration and usage details.

### validation

#### `ValidationError`

- **Source**: `packages/server/src/validation/args-validation.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the validation module documentation for configuration and usage details.

#### `RateLimitError`

- **Source**: `packages/server/src/validation/rate-limit.ts`
- **Message**: Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s
- **Resolution**: Check the validation module documentation for configuration and usage details.

### webhooks

#### `WebhookDeliveryError`

- **Source**: `packages/server/src/webhooks/delivery-queue.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the webhooks module documentation for configuration and usage details.

### workflow

#### `WorkflowError`

- **Source**: `packages/server/src/workflow/workflow.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the workflow module documentation for configuration and usage details.

#### `WorkflowStepError`

- **Source**: `packages/server/src/workflow/workflow.ts`
- **Message**: Step "${stepName}" failed: ${message}
- **Resolution**: Check the workflow module documentation for configuration and usage details.

#### `WorkflowWaitingError`

- **Source**: `packages/server/src/workflow/workflow.ts`
- **Message**: Workflow waiting for event: ${eventName}
- **Resolution**: Check the workflow module documentation for configuration and usage details.

#### `WorkflowCancelledError`

- **Source**: `packages/server/src/workflow/workflow.ts`
- **Message**: Workflow ${workflowId} was cancelled
- **Resolution**: Check the workflow module documentation for configuration and usage details.

### workflow-studio

#### `WorkflowStudioError`

- **Source**: `packages/server/src/workflow-studio/workflow-studio.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the workflow-studio module documentation for configuration and usage details.

### zanzibar

#### `ZanzibarError`

- **Source**: `packages/server/src/zanzibar/zanzibar.ts`
- **Message**: (dynamic message)
- **Resolution**: Check the zanzibar module documentation for configuration and usage details.
