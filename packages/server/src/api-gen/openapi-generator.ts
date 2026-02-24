/**
 * OpenAPI 3.1 spec generator for ReactiveBase.
 * Generates OpenAPI specs from registered query/mutation/action function descriptors,
 * with auto-generated schemas, security schemes, and documentation pages.
 *
 * Usage:
 *   const generator = new OpenApiGenerator({ title: "My API" })
 *   const spec = generator.generateSpec(functions)
 *   const html = generator.generateSwaggerUIHTML(spec)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OpenApi31Schema {
  type?: string
  properties?: Record<string, OpenApi31Schema>
  items?: OpenApi31Schema | { $ref: string }
  required?: string[]
  enum?: string[]
  format?: string
  nullable?: boolean
  description?: string
  $ref?: string
  oneOf?: OpenApi31Schema[]
  allOf?: OpenApi31Schema[]
  default?: unknown
}

export interface OpenApi31Operation {
  operationId: string
  summary: string
  description?: string
  tags: string[]
  parameters?: Array<{
    name: string
    in: "query" | "path" | "header"
    required: boolean
    schema: OpenApi31Schema
    description?: string
  }>
  requestBody?: {
    required: boolean
    content: Record<string, { schema: OpenApi31Schema }>
  }
  responses: Record<
    string,
    {
      description: string
      content?: Record<string, { schema: OpenApi31Schema }>
    }
  >
  security?: Array<Record<string, string[]>>
}

export interface OpenApi31PathItem {
  get?: OpenApi31Operation
  post?: OpenApi31Operation
  put?: OpenApi31Operation
  patch?: OpenApi31Operation
  delete?: OpenApi31Operation
  summary?: string
  description?: string
}

export interface OpenApi31Spec {
  openapi: "3.1.0"
  info: {
    title: string
    version: string
    description?: string
    contact?: { name?: string; url?: string; email?: string }
    license?: { name: string; url?: string }
  }
  servers: Array<{ url: string; description?: string }>
  paths: Record<string, OpenApi31PathItem>
  components: {
    schemas: Record<string, OpenApi31Schema>
    securitySchemes: Record<string, OpenApi31SecurityScheme>
  }
  security: Array<Record<string, string[]>>
  tags?: Array<{ name: string; description?: string }>
}

interface OpenApi31SecurityScheme {
  type: string
  scheme?: string
  in?: string
  name?: string
  description?: string
  bearerFormat?: string
}

export interface FunctionDescriptor {
  /** Function name (used as operationId) */
  name: string
  /** Function type */
  type: "query" | "mutation" | "action"
  /** JSON-Schema-like argument descriptors */
  args: Record<string, ArgSchema>
  /** JSON-Schema-like return type descriptor */
  returns: ReturnSchema
  /** Human-readable description */
  description?: string
  /** Module/tag for grouping */
  module?: string
}

export interface ArgSchema {
  type: string
  description?: string
  required?: boolean
  enum?: string[]
  items?: { type: string }
  properties?: Record<string, ArgSchema>
  default?: unknown
}

export interface ReturnSchema {
  type: string
  description?: string
  properties?: Record<string, ArgSchema>
  items?: { type: string; properties?: Record<string, ArgSchema> }
}

export interface OpenApiGeneratorOptions {
  title?: string
  version?: string
  description?: string
  serverUrl?: string
  basePath?: string
  contact?: { name?: string; url?: string; email?: string }
  license?: { name: string; url?: string }
}

// ─── Generator ───────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<OpenApiGeneratorOptions, "contact" | "license">> = {
  title: "ReactiveBase API",
  version: "1.0.0",
  description: "Auto-generated API from ReactiveBase functions",
  serverUrl: "http://localhost:4000",
  basePath: "/api/v1",
}

export class OpenApiGenerator {
  private options: OpenApiGeneratorOptions

  constructor(options: OpenApiGeneratorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Generate a complete OpenAPI 3.1 spec from function descriptors.
   * Query functions → GET endpoints with query params.
   * Mutation/action functions → POST endpoints with JSON body.
   */
  generateSpec(
    functions: FunctionDescriptor[],
    options?: { tags?: Array<{ name: string; description?: string }> },
  ): OpenApi31Spec {
    const basePath = this.options.basePath ?? DEFAULT_OPTIONS.basePath
    const tags = new Map<string, string>()

    const spec: OpenApi31Spec = {
      openapi: "3.1.0",
      info: {
        title: this.options.title ?? DEFAULT_OPTIONS.title,
        version: this.options.version ?? DEFAULT_OPTIONS.version,
        description: this.options.description,
        contact: this.options.contact,
        license: this.options.license,
      },
      servers: [{ url: this.options.serverUrl ?? DEFAULT_OPTIONS.serverUrl, description: "Default server" }],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "JWT bearer token",
          },
          apiKey: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
            description: "API key for authentication",
          },
        },
      },
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    }

    for (const fn of functions) {
      const tag = fn.module ?? "default"
      if (!tags.has(tag)) {
        tags.set(tag, fn.module ? `Operations for ${fn.module}` : "Default operations")
      }

      const path = `${basePath}/${fn.name}`

      // Generate return type schema
      const returnSchemaName = `${pascalCase(fn.name)}Response`
      spec.components.schemas[returnSchemaName] = this.returnSchemaToOpenApi(fn.returns)

      if (fn.type === "query") {
        // GET endpoint with query params
        const parameters = Object.entries(fn.args).map(([argName, argSchema]) => ({
          name: argName,
          in: "query" as const,
          required: argSchema.required ?? false,
          schema: this.argSchemaToOpenApi(argSchema),
          description: argSchema.description,
        }))

        const pathItem: OpenApi31PathItem = {
          get: {
            operationId: fn.name,
            summary: fn.description ?? `Query ${fn.name}`,
            description: fn.description,
            tags: [tag],
            parameters,
            responses: {
              "200": {
                description: "Successful response",
                content: {
                  "application/json": {
                    schema: { $ref: `#/components/schemas/${returnSchemaName}` },
                  },
                },
              },
              "400": { description: "Bad request" },
              "401": { description: "Unauthorized" },
            },
          },
        }

        spec.paths[path] = { ...spec.paths[path], ...pathItem }
      } else {
        // POST endpoint with JSON body for mutations and actions
        const argSchemaName = `${pascalCase(fn.name)}Input`
        const properties: Record<string, OpenApi31Schema> = {}
        const required: string[] = []

        for (const [argName, argSchema] of Object.entries(fn.args)) {
          properties[argName] = this.argSchemaToOpenApi(argSchema)
          if (argSchema.required !== false) {
            required.push(argName)
          }
        }

        spec.components.schemas[argSchemaName] = {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
        }

        const pathItem: OpenApi31PathItem = {
          post: {
            operationId: fn.name,
            summary: fn.description ?? `${fn.type === "mutation" ? "Mutate" : "Action"} ${fn.name}`,
            description: fn.description,
            tags: [tag],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: `#/components/schemas/${argSchemaName}` },
                },
              },
            },
            responses: {
              "200": {
                description: "Successful response",
                content: {
                  "application/json": {
                    schema: { $ref: `#/components/schemas/${returnSchemaName}` },
                  },
                },
              },
              "400": { description: "Bad request" },
              "401": { description: "Unauthorized" },
            },
          },
        }

        spec.paths[path] = { ...spec.paths[path], ...pathItem }
      }
    }

    // Attach tags
    spec.tags = options?.tags ?? Array.from(tags.entries()).map(([name, description]) => ({ name, description }))

    return spec
  }

  /** Generate an HTML page serving Swagger UI for the given spec. */
  generateSwaggerUIHTML(spec: OpenApi31Spec): string {
    const specJson = JSON.stringify(spec)
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${spec.info.title} - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      spec: ${specJson},
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'StandaloneLayout'
    });
  </script>
</body>
</html>`
  }

  /** Generate an HTML page serving Redoc documentation for the given spec. */
  generateRedocHTML(spec: OpenApi31Spec): string {
    const specJson = JSON.stringify(spec)
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${spec.info.title} - API Documentation</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body { margin: 0; padding: 0; }</style>
</head>
<body>
  <div id="redoc-container"></div>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  <script>
    Redoc.init(${specJson}, {}, document.getElementById('redoc-container'));
  </script>
</body>
</html>`
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private argSchemaToOpenApi(arg: ArgSchema): OpenApi31Schema {
    const schema: OpenApi31Schema = {}

    switch (arg.type) {
      case "string":
        schema.type = "string"
        break
      case "number":
        schema.type = "number"
        schema.format = "double"
        break
      case "integer":
        schema.type = "integer"
        break
      case "boolean":
        schema.type = "boolean"
        break
      case "array":
        schema.type = "array"
        schema.items = arg.items ? { type: arg.items.type } : { type: "string" }
        break
      case "object":
        schema.type = "object"
        if (arg.properties) {
          schema.properties = {}
          for (const [k, v] of Object.entries(arg.properties)) {
            schema.properties[k] = this.argSchemaToOpenApi(v)
          }
        }
        break
      default:
        schema.type = "string"
    }

    if (arg.enum) schema.enum = arg.enum
    if (arg.description) schema.description = arg.description
    if (arg.default !== undefined) schema.default = arg.default

    return schema
  }

  private returnSchemaToOpenApi(ret: ReturnSchema): OpenApi31Schema {
    const schema: OpenApi31Schema = {}

    switch (ret.type) {
      case "string":
        schema.type = "string"
        break
      case "number":
        schema.type = "number"
        break
      case "integer":
        schema.type = "integer"
        break
      case "boolean":
        schema.type = "boolean"
        break
      case "array":
        schema.type = "array"
        if (ret.items) {
          if (ret.items.properties) {
            const props: Record<string, OpenApi31Schema> = {}
            for (const [k, v] of Object.entries(ret.items.properties)) {
              props[k] = this.argSchemaToOpenApi(v)
            }
            schema.items = { type: ret.items.type ?? "object", properties: props }
          } else {
            schema.items = { type: ret.items.type ?? "string" }
          }
        }
        break
      case "object":
        schema.type = "object"
        if (ret.properties) {
          schema.properties = {}
          for (const [k, v] of Object.entries(ret.properties)) {
            schema.properties[k] = this.argSchemaToOpenApi(v)
          }
        }
        break
      default:
        schema.type = "string"
    }

    if (ret.description) schema.description = ret.description
    return schema
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pascalCase(str: string): string {
  return str
    .split(/[-_.]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("")
}
