// --------------------------------------------------------------------------
// Cross-Framework Universal SDK
// Protocol specification and code-generated client SDKs for multiple languages
// --------------------------------------------------------------------------

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProtocolSpec {
  version: string
  endpoints: EndpointSpec[]
  types: TypeSpec[]
  enums: EnumTypeSpec[]
  errors: ErrorSpec[]
  auth: AuthSpec
}

export interface EndpointSpec {
  name: string
  method: "query" | "mutation" | "action" | "subscription"
  path: string
  input?: TypeRef
  output: TypeRef
  auth?: "required" | "optional" | "none"
  description?: string
  deprecated?: boolean
  deprecatedMessage?: string
}

export interface TypeSpec {
  name: string
  fields: FieldSpec[]
  description?: string
}

export interface FieldSpec {
  name: string
  type: TypeRef
  optional: boolean
  description?: string
  defaultValue?: unknown
}

export interface TypeRef {
  kind: "primitive" | "object" | "array" | "enum" | "union" | "map"
  name?: string
  primitive?: "string" | "number" | "boolean" | "null" | "any" | "binary" | "datetime"
  items?: TypeRef
  keyType?: TypeRef
  valueType?: TypeRef
  members?: TypeRef[]
}

export interface EnumTypeSpec {
  name: string
  values: Array<{ name: string; value: string | number; description?: string }>
}

export interface ErrorSpec {
  code: string
  httpStatus: number
  description: string
}

export interface AuthSpec {
  methods: Array<"bearer" | "api-key" | "cookie" | "basic">
  headerName?: string
}

export type TargetLanguage = "typescript" | "python" | "go" | "rust" | "angular" | "htmx"

export interface CodegenOptions {
  target: TargetLanguage
  outputDir?: string
  packageName?: string
  clientClassName?: string
  includeTests?: boolean
  includeReadme?: boolean
}

export interface GeneratedFile {
  path: string
  content: string
  language: string
}

export interface GenerationResult {
  target: TargetLanguage
  files: GeneratedFile[]
  packageName: string
  generatedAt: number
}

export interface UniversalSdkOptions {
  serverUrl?: string
  protocolVersion?: string
}

// ── Error ──────────────────────────────────────────────────────────────────

export class UniversalSdkError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = "UniversalSdkError"
  }
}

// ── Protocol Builder ───────────────────────────────────────────────────────

export class ProtocolBuilder {
  private endpoints: EndpointSpec[] = []
  private types: TypeSpec[] = []
  private enums: EnumTypeSpec[] = []
  private errors: ErrorSpec[] = []
  private auth: AuthSpec = { methods: ["bearer"] }

  addEndpoint(endpoint: EndpointSpec): this {
    this.endpoints.push(endpoint)
    return this
  }

  addType(type: TypeSpec): this {
    this.types.push(type)
    return this
  }

  addEnum(enumSpec: EnumTypeSpec): this {
    this.enums.push(enumSpec)
    return this
  }

  addError(error: ErrorSpec): this {
    this.errors.push(error)
    return this
  }

  setAuth(auth: AuthSpec): this {
    this.auth = auth
    return this
  }

  build(version: string = "1.0.0"): ProtocolSpec {
    return {
      version,
      endpoints: [...this.endpoints],
      types: [...this.types],
      enums: [...this.enums],
      errors: [...this.errors],
      auth: { ...this.auth },
    }
  }
}

// ── Type Mappers ───────────────────────────────────────────────────────────

const typeMappers: Record<TargetLanguage, (ref: TypeRef) => string> = {
  typescript: (ref) => {
    switch (ref.kind) {
      case "primitive":
        switch (ref.primitive) {
          case "string":
            return "string"
          case "number":
            return "number"
          case "boolean":
            return "boolean"
          case "null":
            return "null"
          case "any":
            return "unknown"
          case "binary":
            return "Uint8Array"
          case "datetime":
            return "Date"
          default:
            return "unknown"
        }
      case "object":
        return ref.name || "Record<string, unknown>"
      case "array":
        return ref.items ? `${typeMappers.typescript(ref.items)}[]` : "unknown[]"
      case "enum":
        return ref.name || "string"
      case "union":
        return ref.members?.map((m) => typeMappers.typescript(m)).join(" | ") || "unknown"
      case "map":
        return `Record<${typeMappers.typescript(ref.keyType!)}, ${typeMappers.typescript(ref.valueType!)}>`
      default:
        return "unknown"
    }
  },
  python: (ref) => {
    switch (ref.kind) {
      case "primitive":
        switch (ref.primitive) {
          case "string":
            return "str"
          case "number":
            return "float"
          case "boolean":
            return "bool"
          case "null":
            return "None"
          case "any":
            return "Any"
          case "binary":
            return "bytes"
          case "datetime":
            return "datetime"
          default:
            return "Any"
        }
      case "object":
        return ref.name || "dict[str, Any]"
      case "array":
        return ref.items ? `list[${typeMappers.python(ref.items)}]` : "list[Any]"
      case "enum":
        return ref.name || "str"
      case "map":
        return `dict[${typeMappers.python(ref.keyType!)}, ${typeMappers.python(ref.valueType!)}]`
      default:
        return "Any"
    }
  },
  go: (ref) => {
    switch (ref.kind) {
      case "primitive":
        switch (ref.primitive) {
          case "string":
            return "string"
          case "number":
            return "float64"
          case "boolean":
            return "bool"
          case "null":
            return "interface{}"
          case "any":
            return "interface{}"
          case "binary":
            return "[]byte"
          case "datetime":
            return "time.Time"
          default:
            return "interface{}"
        }
      case "object":
        return ref.name ? `*${ref.name}` : "map[string]interface{}"
      case "array":
        return ref.items ? `[]${typeMappers.go(ref.items)}` : "[]interface{}"
      case "enum":
        return ref.name || "string"
      case "map":
        return `map[${typeMappers.go(ref.keyType!)}]${typeMappers.go(ref.valueType!)}`
      default:
        return "interface{}"
    }
  },
  rust: (ref) => {
    switch (ref.kind) {
      case "primitive":
        switch (ref.primitive) {
          case "string":
            return "String"
          case "number":
            return "f64"
          case "boolean":
            return "bool"
          case "null":
            return "()"
          case "any":
            return "serde_json::Value"
          case "binary":
            return "Vec<u8>"
          case "datetime":
            return "chrono::DateTime<chrono::Utc>"
          default:
            return "serde_json::Value"
        }
      case "object":
        return ref.name || "serde_json::Value"
      case "array":
        return ref.items ? `Vec<${typeMappers.rust(ref.items)}>` : "Vec<serde_json::Value>"
      case "enum":
        return ref.name || "String"
      case "map":
        return `HashMap<${typeMappers.rust(ref.keyType!)}, ${typeMappers.rust(ref.valueType!)}>`
      default:
        return "serde_json::Value"
    }
  },
  angular: (ref) => typeMappers.typescript(ref),
  htmx: (ref) => typeMappers.typescript(ref),
}

// ── Code Generators ────────────────────────────────────────────────────────

function generateTypescript(spec: ProtocolSpec, options: CodegenOptions): GeneratedFile[] {
  const files: GeneratedFile[] = []
  const pkg = options.packageName || "reactivebase-client"
  const cls = options.clientClassName || "ReactiveBaseClient"

  // Types file
  let typesContent = `// Auto-generated by ReactiveBase Universal SDK\n// Protocol version: ${spec.version}\n\n`

  for (const enumSpec of spec.enums) {
    typesContent += `export enum ${enumSpec.name} {\n`
    for (const v of enumSpec.values) {
      typesContent += `  ${v.name} = ${typeof v.value === "string" ? `"${v.value}"` : v.value},\n`
    }
    typesContent += `}\n\n`
  }

  for (const type of spec.types) {
    if (type.description) typesContent += `/** ${type.description} */\n`
    typesContent += `export interface ${type.name} {\n`
    for (const field of type.fields) {
      const optional = field.optional ? "?" : ""
      typesContent += `  ${field.name}${optional}: ${typeMappers.typescript(field.type)};\n`
    }
    typesContent += `}\n\n`
  }
  files.push({ path: `${pkg}/types.ts`, content: typesContent, language: "typescript" })

  // Client file
  let clientContent = `// Auto-generated by ReactiveBase Universal SDK\nimport type { ${spec.types.map((t) => t.name).join(", ")} } from "./types";\n\n`
  clientContent += `export interface ${cls}Options {\n  baseUrl: string;\n  token?: string;\n  headers?: Record<string, string>;\n}\n\n`
  clientContent += `export class ${cls} {\n`
  clientContent += `  private baseUrl: string;\n  private token?: string;\n  private headers: Record<string, string>;\n\n`
  clientContent += `  constructor(options: ${cls}Options) {\n    this.baseUrl = options.baseUrl;\n    this.token = options.token;\n    this.headers = options.headers || {};\n  }\n\n`

  for (const ep of spec.endpoints) {
    const inputType = ep.input ? typeMappers.typescript(ep.input) : "void"
    const outputType = typeMappers.typescript(ep.output)
    const inputParam = ep.input ? `input: ${inputType}` : ""
    const deprecated = ep.deprecated
      ? ep.deprecatedMessage
        ? `  /** @deprecated ${ep.deprecatedMessage} */\n`
        : "  /** @deprecated */\n"
      : ""

    clientContent += `${deprecated}  async ${ep.name}(${inputParam}): Promise<${outputType}> {\n`
    clientContent += `    return this.request("${ep.path}", "${ep.method}"${ep.input ? ", input" : ""});\n`
    clientContent += `  }\n\n`
  }

  clientContent += `  private async request<T>(path: string, method: string, body?: unknown): Promise<T> {\n`
  clientContent += `    const headers: Record<string, string> = { "Content-Type": "application/json", ...this.headers };\n`
  clientContent += `    if (this.token) headers["Authorization"] = \`Bearer \${this.token}\`;\n`
  clientContent += `    const res = await fetch(\`\${this.baseUrl}\${path}\`, {\n`
  clientContent += `      method: body ? "POST" : "GET",\n      headers,\n`
  clientContent += `      body: body ? JSON.stringify(body) : undefined,\n    });\n`
  clientContent += `    if (!res.ok) throw new Error(\`Request failed: \${res.status}\`);\n`
  clientContent += `    return res.json();\n  }\n}\n`

  files.push({ path: `${pkg}/client.ts`, content: clientContent, language: "typescript" })
  return files
}

function generatePython(spec: ProtocolSpec, options: CodegenOptions): GeneratedFile[] {
  const files: GeneratedFile[] = []
  const pkg = options.packageName || "reactivebase_client"
  const cls = options.clientClassName || "ReactiveBaseClient"

  let content = `"""Auto-generated by ReactiveBase Universal SDK - Protocol v${spec.version}"""\nfrom __future__ import annotations\nfrom dataclasses import dataclass, field\nfrom typing import Any, Optional\nfrom enum import Enum\nimport httpx\n\n`

  for (const enumSpec of spec.enums) {
    content += `class ${enumSpec.name}(Enum):\n`
    for (const v of enumSpec.values) {
      content += `    ${v.name} = ${typeof v.value === "string" ? `"${v.value}"` : v.value}\n`
    }
    content += `\n`
  }

  for (const type of spec.types) {
    content += `@dataclass\nclass ${type.name}:\n`
    if (type.description) content += `    """${type.description}"""\n`
    for (const f of type.fields) {
      const pyType = typeMappers.python(f.type)
      content += f.optional
        ? `    ${f.name}: Optional[${pyType}] = None\n`
        : `    ${f.name}: ${pyType} = ${getDefaultPython(f.type)}\n`
    }
    content += `\n`
  }

  content += `class ${cls}:\n`
  content += `    def __init__(self, base_url: str, token: Optional[str] = None):\n`
  content += `        self.base_url = base_url\n`
  content += `        self.token = token\n`
  content += `        self._client = httpx.Client()\n\n`

  for (const ep of spec.endpoints) {
    const inputParam = ep.input ? ", input_data: dict" : ""
    content += `    def ${toSnakeCase(ep.name)}(self${inputParam}) -> dict:\n`
    if (ep.description) content += `        """${ep.description}"""\n`
    content += `        return self._request("${ep.path}", "${ep.method}"${ep.input ? ", input_data" : ""})\n\n`
  }

  content += `    def _request(self, path: str, method: str, body: Optional[dict] = None) -> dict:\n`
  content += `        headers = {"Content-Type": "application/json"}\n`
  content += `        if self.token:\n            headers["Authorization"] = f"Bearer {self.token}"\n`
  content += `        if body:\n            resp = self._client.post(f"{self.base_url}{path}", json=body, headers=headers)\n`
  content += `        else:\n            resp = self._client.get(f"{self.base_url}{path}", headers=headers)\n`
  content += `        resp.raise_for_status()\n        return resp.json()\n`

  files.push({ path: `${pkg}/client.py`, content, language: "python" })
  return files
}

function generateGo(spec: ProtocolSpec, options: CodegenOptions): GeneratedFile[] {
  const files: GeneratedFile[] = []
  const pkg = options.packageName || "reactivebase"

  let content = `// Auto-generated by ReactiveBase Universal SDK - Protocol v${spec.version}\npackage ${pkg}\n\n`
  content += `import (\n\t"bytes"\n\t"encoding/json"\n\t"fmt"\n\t"net/http"\n\t"io"\n)\n\n`

  for (const type of spec.types) {
    if (type.description) content += `// ${type.name} - ${type.description}\n`
    content += `type ${type.name} struct {\n`
    for (const f of type.fields) {
      const goType = typeMappers.go(f.type)
      const jsonTag = `\`json:"${f.name}${f.optional ? ",omitempty" : ""}"\``
      content += `\t${toPascalCase(f.name)} ${goType} ${jsonTag}\n`
    }
    content += `}\n\n`
  }

  content += `type Client struct {\n\tBaseURL  string\n\tToken    string\n\tHTTP     *http.Client\n}\n\n`
  content += `func NewClient(baseURL string, token string) *Client {\n`
  content += `\treturn &Client{BaseURL: baseURL, Token: token, HTTP: &http.Client{}}\n}\n\n`

  for (const ep of spec.endpoints) {
    const funcName = toPascalCase(ep.name)
    const inputParam = ep.input ? `, input ${typeMappers.go(ep.input)}` : ""

    content += `func (c *Client) ${funcName}(${inputParam.replace(/^, /, "")}) (json.RawMessage, error) {\n`
    content += ep.input
      ? `\treturn c.request("${ep.path}", "${ep.method}", input)\n}\n\n`
      : `\treturn c.request("${ep.path}", "${ep.method}", nil)\n}\n\n`
  }

  content += `func (c *Client) request(path string, method string, body interface{}) (json.RawMessage, error) {\n`
  content += `\tvar reqBody io.Reader\n`
  content += `\tif body != nil {\n\t\tb, err := json.Marshal(body)\n\t\tif err != nil {\n\t\t\treturn nil, err\n\t\t}\n\t\treqBody = bytes.NewReader(b)\n\t}\n`
  content += `\thttpMethod := "GET"\n\tif body != nil {\n\t\thttpMethod = "POST"\n\t}\n`
  content += `\treq, err := http.NewRequest(httpMethod, c.BaseURL+path, reqBody)\n`
  content += `\tif err != nil {\n\t\treturn nil, err\n\t}\n`
  content += `\treq.Header.Set("Content-Type", "application/json")\n`
  content += `\tif c.Token != "" {\n\t\treq.Header.Set("Authorization", "Bearer "+c.Token)\n\t}\n`
  content += `\tresp, err := c.HTTP.Do(req)\n`
  content += `\tif err != nil {\n\t\treturn nil, err\n\t}\n\tdefer resp.Body.Close()\n`
  content += `\tif resp.StatusCode >= 400 {\n\t\treturn nil, fmt.Errorf("request failed: %%d", resp.StatusCode)\n\t}\n`
  content += `\tvar result json.RawMessage\n\terr = json.NewDecoder(resp.Body).Decode(&result)\n\treturn result, err\n}\n`

  files.push({ path: `${pkg}/client.go`, content, language: "go" })
  return files
}

function generateRust(spec: ProtocolSpec, options: CodegenOptions): GeneratedFile[] {
  const files: GeneratedFile[] = []
  const pkg = options.packageName || "reactivebase_client"

  let content = `//! Auto-generated by ReactiveBase Universal SDK - Protocol v${spec.version}\n\n`
  content += `use serde::{Deserialize, Serialize};\nuse reqwest::Client as HttpClient;\nuse std::collections::HashMap;\n\n`

  for (const enumSpec of spec.enums) {
    content += `#[derive(Debug, Clone, Serialize, Deserialize)]\npub enum ${enumSpec.name} {\n`
    for (const v of enumSpec.values) {
      content += `    #[serde(rename = "${v.value}")]\n    ${v.name},\n`
    }
    content += `}\n\n`
  }

  for (const type of spec.types) {
    if (type.description) content += `/// ${type.description}\n`
    content += `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${type.name} {\n`
    for (const f of type.fields) {
      const rustType = typeMappers.rust(f.type)
      const fieldType = f.optional ? `Option<${rustType}>` : rustType
      content += `    #[serde(rename = "${f.name}")]\n    pub ${toSnakeCase(f.name)}: ${fieldType},\n`
    }
    content += `}\n\n`
  }

  content += `pub struct ReactiveBaseClient {\n    base_url: String,\n    token: Option<String>,\n    client: HttpClient,\n}\n\n`
  content += `impl ReactiveBaseClient {\n`
  content += `    pub fn new(base_url: &str, token: Option<&str>) -> Self {\n`
  content += `        Self {\n            base_url: base_url.to_string(),\n`
  content += `            token: token.map(|t| t.to_string()),\n            client: HttpClient::new(),\n        }\n    }\n\n`

  for (const ep of spec.endpoints) {
    const fnName = toSnakeCase(ep.name)
    const inputParam = ep.input ? `, input: &serde_json::Value` : ""

    content += `    pub async fn ${fnName}(&self${inputParam}) -> Result<serde_json::Value, reqwest::Error> {\n`
    content += ep.input
      ? `        self.request("${ep.path}", Some(input)).await\n    }\n\n`
      : `        self.request("${ep.path}", None).await\n    }\n\n`
  }

  content += `    async fn request(&self, path: &str, body: Option<&serde_json::Value>) -> Result<serde_json::Value, reqwest::Error> {\n`
  content += `        let url = format!("{}{}", self.base_url, path);\n`
  content += `        let mut req = match body {\n`
  content += `            Some(b) => self.client.post(&url).json(b),\n`
  content += `            None => self.client.get(&url),\n        };\n`
  content += `        if let Some(ref token) = self.token {\n`
  content += `            req = req.header("Authorization", format!("Bearer {}", token));\n        }\n`
  content += `        let resp = req.send().await?.json().await?;\n        Ok(resp)\n    }\n}\n`

  files.push({ path: `${pkg}/src/lib.rs`, content, language: "rust" })
  return files
}

function generateHtmx(spec: ProtocolSpec, options: CodegenOptions): GeneratedFile[] {
  const files: GeneratedFile[] = []
  const pkg = options.packageName || "reactivebase-htmx"

  let content = `<!-- Auto-generated HTMX helpers by ReactiveBase Universal SDK - Protocol v${spec.version} -->\n`
  content += `<script>\n`
  content += `  window.ReactiveBase = {\n`
  content += `    baseUrl: "",\n`
  content += `    token: null,\n`
  content += `    init(baseUrl, token) {\n`
  content += `      this.baseUrl = baseUrl;\n      this.token = token;\n`
  content += `      document.body.setAttribute("hx-headers", JSON.stringify({\n`
  content += `        "Authorization": token ? "Bearer " + token : undefined,\n`
  content += `        "Content-Type": "application/json"\n      }));\n    },\n`

  for (const ep of spec.endpoints) {
    content += `    ${ep.name}Url() { return this.baseUrl + "${ep.path}"; },\n`
  }

  content += `  };\n</script>\n\n`

  // HTMX attribute helpers
  content += `<!-- HTMX attribute helpers -->\n`
  for (const ep of spec.endpoints) {
    const method = ep.method === "query" ? "get" : "post"
    content += `<!-- ${ep.name}: hx-${method}="\${ReactiveBase.baseUrl}${ep.path}" -->\n`
  }

  files.push({ path: `${pkg}/helpers.html`, content, language: "html" })
  return files
}

// ── Utility Functions ──────────────────────────────────────────────────────

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
}

function toPascalCase(str: string): string {
  return str.replace(/(^|_|-)([a-z])/g, (_, __, c) => c.toUpperCase()).replace(/^[a-z]/, (c) => c.toUpperCase())
}

function getDefaultPython(ref: TypeRef): string {
  switch (ref.kind) {
    case "primitive":
      switch (ref.primitive) {
        case "string":
          return '""'
        case "number":
          return "0.0"
        case "boolean":
          return "False"
        default:
          return "None"
      }
    case "array":
      return "field(default_factory=list)"
    case "map":
      return "field(default_factory=dict)"
    default:
      return "None"
  }
}

// ── Universal SDK (Main Engine) ────────────────────────────────────────────

export class UniversalSdk {
  private protocolSpec: ProtocolSpec | null = null
  private generatedResults = new Map<TargetLanguage, GenerationResult>()

  constructor(private readonly options: UniversalSdkOptions = {}) {}

  setProtocol(spec: ProtocolSpec): void {
    this.protocolSpec = spec
    this.generatedResults.clear()
  }

  getProtocol(): ProtocolSpec | null {
    return this.protocolSpec
  }

  generate(options: CodegenOptions): GenerationResult {
    if (!this.protocolSpec) {
      throw new UniversalSdkError("No protocol spec set", "NO_PROTOCOL")
    }

    let files: GeneratedFile[]
    switch (options.target) {
      case "typescript":
        files = generateTypescript(this.protocolSpec, options)
        break
      case "python":
        files = generatePython(this.protocolSpec, options)
        break
      case "go":
        files = generateGo(this.protocolSpec, options)
        break
      case "rust":
        files = generateRust(this.protocolSpec, options)
        break
      case "angular":
        files = generateTypescript(this.protocolSpec, { ...options, target: "angular" })
        break
      case "htmx":
        files = generateHtmx(this.protocolSpec, options)
        break
      default:
        throw new UniversalSdkError(`Unsupported target: ${options.target}`, "UNSUPPORTED_TARGET")
    }

    const result: GenerationResult = {
      target: options.target,
      files,
      packageName: options.packageName || `reactivebase-${options.target}`,
      generatedAt: Date.now(),
    }

    this.generatedResults.set(options.target, result)
    return result
  }

  generateAll(options?: Partial<CodegenOptions>): Map<TargetLanguage, GenerationResult> {
    const targets: TargetLanguage[] = ["typescript", "python", "go", "rust", "htmx"]
    const results = new Map<TargetLanguage, GenerationResult>()

    for (const target of targets) {
      results.set(target, this.generate({ target, ...options }))
    }

    return results
  }

  getGeneratedResult(target: TargetLanguage): GenerationResult | null {
    return this.generatedResults.get(target) || null
  }

  exportProtocolJson(): string {
    if (!this.protocolSpec) {
      throw new UniversalSdkError("No protocol spec set", "NO_PROTOCOL")
    }
    return JSON.stringify(this.protocolSpec, null, 2)
  }

  getSupportedTargets(): TargetLanguage[] {
    return ["typescript", "python", "go", "rust", "angular", "htmx"]
  }
}
