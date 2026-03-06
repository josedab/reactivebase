/**
 * Client Integration Utilities for ReactiveBase GraphQL.
 * Provides ready-to-use configuration generators and typed helpers
 * for Apollo Client, urql, and native graphql-ws.
 *
 * Features:
 *   - Apollo Client setup with subscription split link
 *   - urql client with subscription exchange
 *   - graphql-ws native client wrapper
 *   - Typed subscription document generator
 *   - React hook snippets for subscriptions
 *
 * Usage:
 *   const integrations = new ClientIntegrations({ compiledSchema })
 *   const apolloConfig = integrations.apollo({ wsUrl: 'ws://localhost:4000/graphql' })
 *   const urqlConfig = integrations.urql({ wsUrl: 'ws://localhost:4000/graphql' })
 */

import type { CompiledSchema } from "./schema-compiler.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClientConfigOptions {
  /** WebSocket URL for subscriptions */
  wsUrl: string
  /** HTTP URL for queries/mutations (auto-derived from wsUrl if omitted) */
  httpUrl?: string
  /** Whether to include type definitions inline (default: false) */
  inlineTypes?: boolean
  /** Auth token header name (default: "Authorization") */
  authHeaderName?: string
}

export interface GeneratedClientConfig {
  /** Ready-to-paste setup code */
  code: string
  /** Client library name */
  clientName: string
  /** Required npm packages */
  dependencies: string[]
}

export interface SubscriptionDocumentOptions {
  /** Table/type to subscribe to */
  typeName: string
  /** Granularity: row, collection, or field */
  granularity: "row" | "collection" | "field"
  /** Specific fields to select */
  selectFields?: string[]
  /** Specific fields to watch (for field-level granularity) */
  watchFields?: string[]
}

export interface GeneratedDocument {
  /** GraphQL document string */
  document: string
  /** Suggested variable name */
  variableName: string
  /** TypeScript type for the subscription result */
  resultType: string
}

// ─── Client Integrations ─────────────────────────────────────────────────────

export class ClientIntegrations {
  private compiledSchema: CompiledSchema | null

  constructor(options?: { compiledSchema?: CompiledSchema }) {
    this.compiledSchema = options?.compiledSchema ?? null
  }

  /**
   * Generate Apollo Client configuration with subscription support.
   */
  apollo(options: ClientConfigOptions): GeneratedClientConfig {
    const httpUrl = options.httpUrl ?? deriveHttpUrl(options.wsUrl)
    const authHeader = options.authHeaderName ?? "Authorization"

    const code = `import { ApolloClient, InMemoryCache, split, HttpLink } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

const httpLink = new HttpLink({
  uri: '${httpUrl}',
  headers: { '${authHeader}': \`Bearer \${token}\` },
});

const wsLink = new GraphQLWsLink(
  createClient({
    url: '${options.wsUrl}',
    connectionParams: () => ({
      authToken: token,
    }),
    shouldRetry: () => true,
    retryAttempts: 5,
  })
);

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
  },
  wsLink,
  httpLink,
);

export const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          // Enable Relay-style pagination merge
          ${this.generateRelayTypePolicies()}
        },
      },
    },
  }),
});`

    return {
      code,
      clientName: "Apollo Client",
      dependencies: ["@apollo/client", "graphql-ws", "graphql"],
    }
  }

  /**
   * Generate urql client configuration with subscription exchange.
   */
  urql(options: ClientConfigOptions): GeneratedClientConfig {
    const httpUrl = options.httpUrl ?? deriveHttpUrl(options.wsUrl)

    const code = `import { createClient, fetchExchange, subscriptionExchange, cacheExchange } from 'urql';
import { createClient as createWSClient } from 'graphql-ws';

const wsClient = createWSClient({
  url: '${options.wsUrl}',
  connectionParams: () => ({
    authToken: token,
  }),
  shouldRetry: () => true,
  retryAttempts: 5,
});

export const client = createClient({
  url: '${httpUrl}',
  exchanges: [
    cacheExchange,
    fetchExchange,
    subscriptionExchange({
      forwardSubscription: (request) => ({
        subscribe: (sink) => ({
          unsubscribe: wsClient.subscribe(request, sink),
        }),
      }),
    }),
  ],
});`

    return {
      code,
      clientName: "urql",
      dependencies: ["urql", "graphql-ws", "graphql"],
    }
  }

  /**
   * Generate a native graphql-ws client configuration.
   */
  graphqlWs(options: ClientConfigOptions): GeneratedClientConfig {
    const code = `import { createClient } from 'graphql-ws';

export const client = createClient({
  url: '${options.wsUrl}',
  connectionParams: () => ({
    authToken: token,
  }),
  shouldRetry: () => true,
  retryAttempts: 5,
  keepAlive: 30_000,
  on: {
    connected: () => console.log('[ReactiveBase] GraphQL WS connected'),
    closed: () => console.log('[ReactiveBase] GraphQL WS disconnected'),
    error: (err) => console.error('[ReactiveBase] GraphQL WS error', err),
  },
});

// Subscribe to changes
export function subscribe<T>(query: string, variables?: Record<string, unknown>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let deferred: { resolve: (value: IteratorResult<T>) => void } | null = null;
      const queue: T[] = [];
      let done = false;

      const dispose = client.subscribe(
        { query, variables },
        {
          next: (value) => {
            const data = value.data as T;
            if (deferred) {
              deferred.resolve({ value: data, done: false });
              deferred = null;
            } else {
              queue.push(data);
            }
          },
          error: () => { done = true; },
          complete: () => { done = true; },
        }
      );

      return {
        next() {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false });
          if (done) return Promise.resolve({ value: undefined as unknown as T, done: true });
          return new Promise<IteratorResult<T>>((resolve) => { deferred = { resolve }; });
        },
        return() {
          dispose();
          done = true;
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        },
      };
    },
  };
}`

    return {
      code,
      clientName: "graphql-ws",
      dependencies: ["graphql-ws"],
    }
  }

  /**
   * Generate a typed subscription document for a given type.
   */
  generateSubscriptionDocument(options: SubscriptionDocumentOptions): GeneratedDocument {
    const { typeName, granularity, selectFields, watchFields } = options
    const fields = selectFields ?? this.getTypeFields(typeName)
    const fieldSelection = fields.length > 0 ? fields.join("\n    ") : "id"

    let document: string
    let variableName: string

    switch (granularity) {
      case "row":
        variableName = `ON_${typeName.toUpperCase()}_CHANGED`
        document = `subscription ${variableName}($where: ${typeName}WhereInput) {
  on${typeName}Changed(where: $where) {
    ${fieldSelection}
  }
}`
        break

      case "collection":
        variableName = `ON_${typeName.toUpperCase()}_LIST`
        document = `subscription ${variableName}($where: ${typeName}WhereInput, $limit: Int) {
  on${typeName}List(where: $where, limit: $limit) {
    ${fieldSelection}
  }
}`
        break

      case "field":
        variableName = `ON_${typeName.toUpperCase()}_FIELD_CHANGED`
        document = `subscription ${variableName}($id: ID!, $fields: [String!]!) {
  on${typeName}FieldChanged(id: $id, fields: $fields) {
    ${watchFields?.join("\n    ") ?? fieldSelection}
  }
}`
        break
    }

    const resultType = `{ on${typeName}${granularity === "collection" ? "List" : granularity === "field" ? "FieldChanged" : "Changed"}: ${typeName}${granularity === "collection" ? "[]" : ""} }`

    return { document, variableName, resultType }
  }

  /**
   * Generate React hook snippets for all subscription types.
   */
  generateReactHooks(): string {
    if (!this.compiledSchema) return "// No compiled schema available"

    const lines: string[] = [
      "// Auto-generated React hooks for ReactiveBase GraphQL subscriptions",
      "// Usage with Apollo: import { useSubscription } from '@apollo/client';",
      "// Usage with urql: import { useSubscription } from 'urql';",
      "",
    ]

    for (const [, type] of Object.entries(this.compiledSchema.typeMap)) {
      const fields = type.fields
        .filter((f) => !f.isRelation)
        .map((f) => f.name)
        .join(", ")

      lines.push(`// Subscribe to ${type.tableName} changes`)
      lines.push(`export const ON_${type.name.toUpperCase()}_CHANGED = \``)
      lines.push(`  subscription On${type.name}Changed($where: ${type.name}WhereInput) {`)
      lines.push(`    on${type.name}Changed(where: $where) {`)
      lines.push(`      ${fields}`)
      lines.push("    }")
      lines.push("  }")
      lines.push("`;")
      lines.push("")
    }

    return lines.join("\n")
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private getTypeFields(typeName: string): string[] {
    if (!this.compiledSchema) return ["id"]

    const type = this.compiledSchema.typeMap[typeName]
    if (!type) return ["id"]

    return type.fields.filter((f) => !f.isRelation).map((f) => f.name)
  }

  private generateRelayTypePolicies(): string {
    if (!this.compiledSchema) return ""

    return Object.values(this.compiledSchema.typeMap)
      .filter((t) => t.hasRelayCursor)
      .map((t) => `${t.tableName}: { keyArgs: ['where'], merge: true }`)
      .join(",\n          ")
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveHttpUrl(wsUrl: string): string {
  return wsUrl.replace("ws://", "http://").replace("wss://", "https://")
}
