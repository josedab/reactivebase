/**
 * Tests for ReactiveComponents hooks and provider.
 * Tests hook logic and component exports without full React DOM rendering,
 * consistent with the project's existing test patterns.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock React hooks for non-DOM testing ─────────────────────────────────────

let stateStore: Record<string, unknown> = {}
let stateIdx = 0

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useState: vi.fn((initial: unknown) => {
      const key = `state_${stateIdx++}`
      if (!(key in stateStore)) stateStore[key] = typeof initial === "function" ? (initial as () => unknown)() : initial
      return [
        stateStore[key],
        (val: unknown) => {
          stateStore[key] = typeof val === "function" ? (val as (prev: unknown) => unknown)(stateStore[key]) : val
        },
      ]
    }),
    useCallback: vi.fn((fn: unknown) => fn),
    useMemo: vi.fn((fn: () => unknown) => fn()),
    useEffect: vi.fn(),
    useRef: vi.fn((v: unknown) => ({ current: v })),
    useContext: vi.fn(() => ({ theme: {} })),
    createContext: actual.createContext,
  }
})

// Mock the hooks module before importing reactive-components
vi.mock("../hooks/index.js", () => {
  return {
    useQuery: vi.fn((_ref: unknown, _args?: unknown, _opts?: unknown) => undefined),
    useMutation: vi.fn((_ref: unknown) => vi.fn(async () => ({ success: true }))),
  }
})

import { useQuery, useMutation } from "../hooks/index.js"

const mockUseQuery = vi.mocked(useQuery)
const mockUseMutation = vi.mocked(useMutation)

// ── Import after mocks ───────────────────────────────────────────────────────

import {
  ReactiveComponentProvider,
  useReactiveQuery,
  useReactiveTable,
  useReactiveForm,
  ReactiveTable,
  ReactiveForm,
  useReactiveChart,
  ReactiveChart,
  type ReactiveTableColumn,
  type ReactiveFormSchema,
  type ReactiveComponentTheme,
} from "../reactive-components.js"

// ── Exports ─────────────────────────────────────────────────────────────────

describe("reactive-components exports", () => {
  it("exports all expected symbols", () => {
    expect(ReactiveComponentProvider).toBeDefined()
    expect(useReactiveQuery).toBeDefined()
    expect(useReactiveTable).toBeDefined()
    expect(useReactiveForm).toBeDefined()
    expect(ReactiveTable).toBeDefined()
    expect(ReactiveForm).toBeDefined()
    expect(useReactiveChart).toBeDefined()
    expect(ReactiveChart).toBeDefined()
  })
})

// ── useReactiveQuery ────────────────────────────────────────────────────────

describe("useReactiveQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stateStore = {}
    stateIdx = 0
    stateStore = {}
    stateIdx = 0
  })

  it("returns loading state when data is undefined", () => {
    mockUseQuery.mockReturnValue(undefined)
    const result = useReactiveQuery("getUsers")
    expect(result.isLoading).toBe(true)
    expect(result.data).toBeUndefined()
    expect(result.error).toBeNull()
  })

  it("returns data when query resolves", () => {
    const data = [{ id: 1, name: "Alice" }]
    mockUseQuery.mockReturnValue(data)
    const result = useReactiveQuery("getUsers")
    expect(result.isLoading).toBe(false)
    expect(result.data).toEqual(data)
    expect(result.error).toBeNull()
  })

  it("accepts string query name", () => {
    mockUseQuery.mockReturnValue([])
    useReactiveQuery("getUsers", { active: true })
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({ _name: "getUsers" }),
      { active: true },
      expect.any(Object),
    )
  })

  it("accepts FunctionReference query", () => {
    const ref = { _name: "getUsers", _type: "query" as const }
    mockUseQuery.mockReturnValue([])
    useReactiveQuery(ref)
    expect(mockUseQuery).toHaveBeenCalledWith(ref, undefined, expect.any(Object))
  })

  it("passes enabled option", () => {
    mockUseQuery.mockReturnValue(undefined)
    useReactiveQuery("getUsers", {}, { enabled: false })
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    )
  })
})

// ── useReactiveTable ────────────────────────────────────────────────────────

describe("useReactiveTable", () => {
  const columns: ReactiveTableColumn[] = [
    { key: "name", label: "Name", sortable: true, filterable: true },
    { key: "age", label: "Age", sortable: true },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    stateStore = {}
    stateIdx = 0
  })

  it("returns loading state when data is undefined", () => {
    mockUseQuery.mockReturnValue(undefined)
    const state = useReactiveTable({ query: "getUsers", columns })
    expect(state.isLoading).toBe(true)
    expect(state.data).toEqual([])
  })

  it("returns table state with data", () => {
    mockUseQuery.mockReturnValue([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ])
    const state = useReactiveTable({ query: "getUsers", columns })
    expect(state.isLoading).toBe(false)
    expect(state.data).toHaveLength(2)
    expect(state.totalItems).toBe(2)
  })

  it("provides sorting functionality", () => {
    mockUseQuery.mockReturnValue([
      { name: "Charlie", age: 35 },
      { name: "Alice", age: 30 },
    ])
    const state = useReactiveTable({ query: "getUsers", columns })
    expect(state.sortKey).toBeNull()
    expect(state.sortDirection).toBe("asc")
    expect(typeof state.handleSort).toBe("function")
  })

  it("provides filter functionality", () => {
    mockUseQuery.mockReturnValue([{ name: "Alice" }])
    const state = useReactiveTable({ query: "getUsers", columns })
    expect(state.filters).toEqual({})
    expect(typeof state.setFilter).toBe("function")
    expect(typeof state.clearFilters).toBe("function")
  })

  it("provides pagination with default pageSize", () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ name: `User ${i}`, age: 20 + i }))
    mockUseQuery.mockReturnValue(data)
    const state = useReactiveTable({ query: "getUsers", columns })
    expect(state.pageSize).toBe(20)
    expect(state.page).toBe(0)
    expect(state.totalPages).toBe(3)
    expect(state.pagedData).toHaveLength(20)
  })

  it("provides pagination with custom pageSize", () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ name: `U${i}`, age: i }))
    mockUseQuery.mockReturnValue(data)
    const state = useReactiveTable({
      query: "getUsers",
      columns,
      pagination: { pageSize: 5 },
    })
    expect(state.pageSize).toBe(5)
    expect(state.totalPages).toBe(2)
    expect(state.pagedData).toHaveLength(5)
  })

  it("provides selection state", () => {
    mockUseQuery.mockReturnValue([{ name: "A" }, { name: "B" }])
    const state = useReactiveTable({ query: "getUsers", columns })
    expect(state.selectedRows.size).toBe(0)
    expect(state.selectedData).toEqual([])
    expect(typeof state.toggleRow).toBe("function")
    expect(typeof state.toggleAll).toBe("function")
  })

  it("exposes getCellValue for custom rendering", () => {
    mockUseQuery.mockReturnValue([{ name: "Alice", age: 30 }])
    const state = useReactiveTable({ query: "getUsers", columns })
    const value = state.getCellValue({ name: "Alice", age: 30 }, columns[0])
    expect(value).toBe("Alice")
  })

  it("getCellValue uses formatter when provided", () => {
    const formatter = vi.fn((_val: unknown, _row: unknown) => "formatted")
    const colsWithFormatter: ReactiveTableColumn[] = [{ key: "name", label: "Name", formatter }]
    mockUseQuery.mockReturnValue([{ name: "Alice" }])
    const state = useReactiveTable({ query: "getUsers", columns: colsWithFormatter })
    const value = state.getCellValue({ name: "Alice" }, colsWithFormatter[0])
    expect(value).toBe("formatted")
    expect(formatter).toHaveBeenCalledWith("Alice", { name: "Alice" })
  })

  it("handles empty data gracefully", () => {
    mockUseQuery.mockReturnValue([])
    const state = useReactiveTable({ query: "getUsers", columns })
    expect(state.data).toEqual([])
    expect(state.pagedData).toEqual([])
    expect(state.totalPages).toBe(1)
  })

  it("navigation functions exist", () => {
    mockUseQuery.mockReturnValue([])
    const state = useReactiveTable({ query: "getUsers", columns })
    expect(typeof state.nextPage).toBe("function")
    expect(typeof state.prevPage).toBe("function")
    expect(typeof state.setPage).toBe("function")
  })
})

// ── useReactiveForm ─────────────────────────────────────────────────────────

describe("useReactiveForm", () => {
  const testSchema: ReactiveFormSchema = {
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      {
        name: "priority",
        label: "Priority",
        type: "number",
        validate: (v) => (Number(v) < 0 ? "Must be positive" : null),
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    stateStore = {}
    stateIdx = 0
    mockUseMutation.mockReturnValue(vi.fn(async () => ({ success: true })))
  })

  it("initializes with default values", () => {
    const state = useReactiveForm({ schema: testSchema })
    expect(state.values.title).toBe("")
    expect(state.values.description).toBe("")
    expect(state.isDirty).toBe(false)
    expect(state.isSubmitting).toBe(false)
  })

  it("initializes with provided initial values", () => {
    const state = useReactiveForm({
      schema: testSchema,
      initialValues: { title: "Hello" },
    })
    expect(state.values.title).toBe("Hello")
  })

  it("resolves fields from schema", () => {
    const state = useReactiveForm({ schema: testSchema })
    expect(state.fields).toHaveLength(3)
    expect(state.fields[0].name).toBe("title")
  })

  it("filters fields when field names provided", () => {
    const state = useReactiveForm({ schema: testSchema, fields: ["title"] })
    expect(state.fields).toHaveLength(1)
    expect(state.fields[0].name).toBe("title")
  })

  it("creates fields from string array without schema", () => {
    const state = useReactiveForm({ fields: ["name", "email"] })
    expect(state.fields).toHaveLength(2)
    expect(state.fields[0].name).toBe("name")
    expect(state.fields[0].type).toBe("text")
  })

  it("isValid reflects validation state", () => {
    const state = useReactiveForm({ schema: testSchema })
    // title is required but empty - should be invalid
    expect(state.isValid).toBe(false)
  })

  it("validation none always reports valid", () => {
    const state = useReactiveForm({ schema: testSchema, validation: "none" })
    expect(state.isValid).toBe(true)
  })

  it("getValue and setValue work", () => {
    const state = useReactiveForm({ schema: testSchema })
    expect(state.getValue("title")).toBe("")
    // setValue is a React state setter - we test it exists
    expect(typeof state.setValue).toBe("function")
    expect(typeof state.setValues).toBe("function")
  })

  it("reset function exists", () => {
    const state = useReactiveForm({ schema: testSchema })
    expect(typeof state.reset).toBe("function")
  })

  it("handleSubmit function exists", () => {
    const state = useReactiveForm({ schema: testSchema })
    expect(typeof state.handleSubmit).toBe("function")
  })

  it("handleSubmit validates before submitting", async () => {
    const onSubmit = vi.fn()
    const state = useReactiveForm({ schema: testSchema, onSubmit })
    // title is required but empty - should not call onSubmit
    await state.handleSubmit()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

// ── useReactiveChart ────────────────────────────────────────────────────────

describe("useReactiveChart", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stateStore = {}
    stateIdx = 0
    stateStore = {}
    stateIdx = 0
  })

  it("returns chart state with data", () => {
    mockUseQuery.mockReturnValue([
      { month: "Jan", sales: 100 },
      { month: "Feb", sales: 200 },
    ])
    const state = useReactiveChart({
      query: "getSales",
      type: "bar",
      xAxis: "month",
      yAxis: "sales",
    })
    expect(state.isLoading).toBe(false)
    expect(state.data).toHaveLength(2)
    expect(state.data[0].label).toBe("Jan")
    expect(state.data[0].value).toBe(100)
  })

  it("returns loading state when data is undefined", () => {
    mockUseQuery.mockReturnValue(undefined)
    const state = useReactiveChart({
      query: "getSales",
      type: "bar",
      xAxis: "month",
      yAxis: "sales",
    })
    expect(state.isLoading).toBe(true)
    expect(state.data).toEqual([])
  })

  it("handles empty data", () => {
    mockUseQuery.mockReturnValue([])
    const state = useReactiveChart({
      query: "getSales",
      type: "bar",
      xAxis: "month",
      yAxis: "sales",
    })
    expect(state.data).toEqual([])
    expect(state.maxValue).toBe(0)
    expect(state.totalValue).toBe(0)
  })

  it("computes max and total values", () => {
    mockUseQuery.mockReturnValue([
      { x: "A", y: 10 },
      { x: "B", y: 50 },
      { x: "C", y: 30 },
    ])
    const state = useReactiveChart({
      query: "getData",
      type: "line",
      xAxis: "x",
      yAxis: "y",
    })
    expect(state.maxValue).toBe(50)
    expect(state.totalValue).toBe(90)
  })
})

// ── ReactiveComponentProvider ───────────────────────────────────────────────

describe("ReactiveComponentProvider", () => {
  it("is a function (React component)", () => {
    expect(typeof ReactiveComponentProvider).toBe("function")
  })
})

// ── Theme types ─────────────────────────────────────────────────────────────

describe("theme types", () => {
  it("accepts valid theme object", () => {
    const theme: ReactiveComponentTheme = {
      table: { container: "my-table", header: "my-header" },
      form: { container: "my-form" },
      chart: { container: "my-chart" },
    }
    expect(theme.table?.container).toBe("my-table")
  })
})
