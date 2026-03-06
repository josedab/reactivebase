/**
 * Embeddable Reactive Components for React.
 * Enhanced data-bound components with headless variants for custom rendering.
 *
 * Components:
 *   - ReactiveTable: Data table with sorting, filtering, pagination, row selection, formatters
 *   - ReactiveForm: Auto-generated form with schema validation and mutation binding
 *   - ReactiveChart: Chart component with bar, line, pie types and real-time updates
 *   - ReactiveComponentProvider: Context provider with theme configuration
 *
 * Hooks:
 *   - useReactiveQuery: Bind any query with live updates
 *   - useReactiveTable: Headless table state management
 *   - useReactiveForm: Headless form state management
 *   - useReactiveChart: Headless chart data processing
 */

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useContext,
  createContext,
  type ReactNode,
  type FormEvent,
  type ChangeEvent,
} from "react"
import { useQuery, useMutation } from "./hooks/index.js"
import type { FunctionReference } from "./hooks/index.js"

// ─── Theme & Provider ────────────────────────────────────────────────────────

export interface ReactiveComponentTheme {
  table?: {
    container?: string
    header?: string
    headerCell?: string
    row?: string
    cell?: string
    pagination?: string
    filter?: string
    empty?: string
  }
  form?: {
    container?: string
    field?: string
    label?: string
    input?: string
    error?: string
    submit?: string
  }
  chart?: {
    container?: string
    bar?: string
    line?: string
    pie?: string
    label?: string
    tooltip?: string
  }
}

interface ReactiveComponentContextValue {
  theme: ReactiveComponentTheme
  classNamePrefix?: string
}

const ReactiveComponentContext = createContext<ReactiveComponentContextValue>({
  theme: {},
})

export interface ReactiveComponentProviderProps {
  theme?: ReactiveComponentTheme
  classNamePrefix?: string
  children: ReactNode
}

export function ReactiveComponentProvider({
  theme = {},
  classNamePrefix,
  children,
}: ReactiveComponentProviderProps): ReactNode {
  const value = useMemo(() => ({ theme, classNamePrefix }), [theme, classNamePrefix])
  return <ReactiveComponentContext.Provider value={value}>{children}</ReactiveComponentContext.Provider>
}

function useTheme() {
  return useContext(ReactiveComponentContext)
}

/** Generate className with optional prefix and Tailwind-compatible class merging */
function buildClassName(prefix: string | undefined, base: string, themeClass?: string, userClass?: string): string {
  const parts: string[] = []
  parts.push(prefix ? `${prefix}-${base}` : `rb-${base}`)
  if (themeClass) parts.push(themeClass)
  if (userClass) parts.push(userClass)
  return parts.join(" ")
}

// ─── useReactiveQuery ────────────────────────────────────────────────────────

export interface ReactiveQueryOptions {
  enabled?: boolean
  refetchInterval?: number
}

export interface ReactiveQueryResult<T> {
  data: T | undefined
  isLoading: boolean
  error: Error | null
}

/** Bind any query with live updates, returning data, loading, and error state. */
export function useReactiveQuery<T = unknown>(
  query: FunctionReference<unknown, T> | string,
  args?: Record<string, unknown>,
  options?: ReactiveQueryOptions,
): ReactiveQueryResult<T> {
  const queryRef = typeof query === "string" ? { _name: query, _type: "query" as const } : query
  const [error, setError] = useState<Error | null>(null)

  let data: T | undefined
  try {
    data = useQuery(queryRef, args, { enabled: options?.enabled }) as T | undefined
  } catch (err: unknown) {
    if (!error) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  const isLoading = data === undefined && error === null

  return useMemo(() => ({ data, isLoading, error }), [data, isLoading, error])
}

// ─── ReactiveTable Types ─────────────────────────────────────────────────────

export interface ReactiveTableColumn<T = Record<string, unknown>> {
  key: string
  label: string
  header?: string
  sortable?: boolean
  filterable?: boolean
  width?: string | number
  formatter?: (value: unknown, row: T) => ReactNode
  render?: (value: unknown, row: T) => ReactNode
}

export interface ReactiveTablePagination {
  pageSize: number
  showPageNumbers?: boolean
}

export interface ReactiveTableProps<T = Record<string, unknown>> {
  query: FunctionReference<unknown, T[]> | string
  args?: Record<string, unknown>
  columns: ReactiveTableColumn<T>[]
  pagination?: ReactiveTablePagination | { pageSize: number }
  sortable?: boolean
  onRowClick?: (row: T) => void
  onSelectionChange?: (selected: T[]) => void
  selectable?: boolean
  emptyMessage?: string
  className?: string
  rowKey?: string
}

// ─── HeadlessTableState ──────────────────────────────────────────────────────

export interface HeadlessTableState<T = Record<string, unknown>> {
  data: T[]
  isLoading: boolean
  sortKey: string | null
  sortDirection: "asc" | "desc"
  handleSort: (key: string) => void
  filters: Record<string, string>
  setFilter: (key: string, value: string) => void
  clearFilters: () => void
  page: number
  pageSize: number
  totalPages: number
  totalItems: number
  setPage: (page: number) => void
  nextPage: () => void
  prevPage: () => void
  pagedData: T[]
  selectedRows: Set<number>
  toggleRow: (index: number) => void
  toggleAll: () => void
  selectedData: T[]
  columns: ReactiveTableColumn<T>[]
  getCellValue: (row: T, column: ReactiveTableColumn<T>) => ReactNode
}

// ─── useReactiveTable ────────────────────────────────────────────────────────

/** Headless hook that returns all table state and helpers for custom rendering. */
export function useReactiveTable<T extends Record<string, unknown>>({
  query,
  args = {},
  columns,
  pagination,
  sortable = true,
}: Pick<ReactiveTableProps<T>, "query" | "args" | "columns" | "pagination" | "sortable">): HeadlessTableState<T> {
  const queryRef = typeof query === "string" ? { _name: query, _type: "query" as const } : query
  const rawData = useQuery(queryRef, args)
  const pageSize = pagination?.pageSize ?? 20

  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())

  const isLoading = rawData === undefined
  const data: T[] = useMemo(() => (Array.isArray(rawData) ? rawData : []), [rawData])

  const filtered = useMemo(() => {
    let items = [...data]
    for (const [key, filterValue] of Object.entries(filters)) {
      if (!filterValue) continue
      const lower = filterValue.toLowerCase()
      items = items.filter((row) =>
        String(row[key] ?? "")
          .toLowerCase()
          .includes(lower),
      )
    }
    return items
  }, [data, filters])

  const sorted = useMemo(() => {
    const items = [...filtered]
    if (sortKey) {
      items.sort((a, b) => {
        const cmp = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""))
        return sortDir === "asc" ? cmp : -cmp
      })
    }
    return items
  }, [filtered, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))

  const pagedData = useMemo(() => sorted.slice(page * pageSize, (page + 1) * pageSize), [sorted, page, pageSize])

  const handleSort = useCallback(
    (key: string) => {
      if (!sortable) return
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"))
      } else {
        setSortKey(key)
        setSortDir("asc")
      }
      setPage(0)
    },
    [sortKey, sortable],
  )

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(0)
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({})
    setPage(0)
  }, [])

  const toggleRow = useCallback((index: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedRows((prev) => {
      if (prev.size === pagedData.length) return new Set()
      return new Set(pagedData.map((_, i) => i))
    })
  }, [pagedData])

  const selectedData = useMemo(
    () =>
      Array.from(selectedRows)
        .filter((i) => i < pagedData.length)
        .map((i) => pagedData[i]),
    [selectedRows, pagedData],
  )

  const getCellValue = useCallback((_row: T, column: ReactiveTableColumn<T>): ReactNode => {
    const raw = _row[column.key]
    if (column.formatter) return column.formatter(raw, _row)
    if (column.render) return column.render(raw, _row)
    return String(raw ?? "")
  }, [])

  const nextPage = useCallback(() => setPage((p) => Math.min(totalPages - 1, p + 1)), [totalPages])
  const prevPage = useCallback(() => setPage((p) => Math.max(0, p - 1)), [])

  return {
    data: sorted,
    isLoading,
    sortKey,
    sortDirection: sortDir,
    handleSort,
    filters,
    setFilter,
    clearFilters,
    page,
    pageSize,
    totalPages,
    totalItems: sorted.length,
    setPage,
    nextPage,
    prevPage,
    pagedData,
    selectedRows,
    toggleRow,
    toggleAll,
    selectedData,
    columns,
    getCellValue,
  }
}

// ─── ReactiveTable Component ─────────────────────────────────────────────────

/** Drop-in data table bound to ReactiveBase queries with sorting, filtering, pagination, and row selection. */
export function ReactiveTable<T extends Record<string, unknown>>(props: ReactiveTableProps<T>): ReactNode {
  const {
    onRowClick,
    onSelectionChange,
    selectable = false,
    emptyMessage = "No data",
    className,
    rowKey = "id",
  } = props
  const table = useReactiveTable(props)
  const { theme, classNamePrefix } = useTheme()

  useEffect(() => {
    onSelectionChange?.(table.selectedData)
  }, [table.selectedData, onSelectionChange])

  if (table.isLoading) {
    return (
      <div className={buildClassName(classNamePrefix, "table-loading", theme.table?.container, className)}>
        Loading...
      </div>
    )
  }

  return (
    <div className={buildClassName(classNamePrefix, "table", theme.table?.container, className)}>
      {/* Column filters */}
      {table.columns.some((c) => c.filterable) && (
        <div
          className={buildClassName(classNamePrefix, "table-filters", theme.table?.filter)}
          style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}
        >
          {table.columns
            .filter((c) => c.filterable)
            .map((col) => (
              <input
                key={col.key}
                type="text"
                placeholder={`Filter ${col.label ?? col.header ?? col.key}...`}
                value={table.filters[col.key] ?? ""}
                onChange={(e: ChangeEvent<HTMLInputElement>) => table.setFilter(col.key, e.target.value)}
                style={{ padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "14px" }}
              />
            ))}
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr className={buildClassName(classNamePrefix, "table-header-row", theme.table?.header)}>
            {selectable && (
              <th style={{ padding: "8px", width: "40px", borderBottom: "2px solid #e2e8f0" }}>
                <input
                  type="checkbox"
                  checked={table.selectedRows.size === table.pagedData.length && table.pagedData.length > 0}
                  onChange={table.toggleAll}
                />
              </th>
            )}
            {table.columns.map((col) => (
              <th
                key={col.key}
                className={buildClassName(classNamePrefix, "table-header-cell", theme.table?.headerCell)}
                onClick={
                  col.sortable !== false && props.sortable !== false ? () => table.handleSort(col.key) : undefined
                }
                style={{
                  cursor: col.sortable !== false && props.sortable !== false ? "pointer" : "default",
                  padding: "8px",
                  textAlign: "left",
                  borderBottom: "2px solid #e2e8f0",
                  width: col.width,
                  userSelect: "none",
                }}
              >
                {col.label ?? col.header ?? col.key}
                {table.sortKey === col.key ? (table.sortDirection === "asc" ? " ↑" : " ↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.pagedData.length === 0 ? (
            <tr>
              <td
                colSpan={table.columns.length + (selectable ? 1 : 0)}
                className={buildClassName(classNamePrefix, "table-empty", theme.table?.empty)}
                style={{ padding: "16px", textAlign: "center", opacity: 0.5 }}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            table.pagedData.map((row, idx) => (
              <tr
                key={String((row as Record<string, unknown>)[rowKey] ?? idx)}
                className={buildClassName(classNamePrefix, "table-row", theme.table?.row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{
                  cursor: onRowClick ? "pointer" : "default",
                  borderBottom: "1px solid #e2e8f0",
                  backgroundColor: table.selectedRows.has(idx) ? "#eff6ff" : undefined,
                }}
              >
                {selectable && (
                  <td style={{ padding: "8px" }}>
                    <input
                      type="checkbox"
                      checked={table.selectedRows.has(idx)}
                      onChange={() => table.toggleRow(idx)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                )}
                {table.columns.map((col) => (
                  <td
                    key={col.key}
                    className={buildClassName(classNamePrefix, "table-cell", theme.table?.cell)}
                    style={{ padding: "8px" }}
                  >
                    {table.getCellValue(row, col)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {table.totalPages > 1 && (
        <div
          className={buildClassName(classNamePrefix, "table-pagination", theme.table?.pagination)}
          style={{ display: "flex", gap: "8px", justifyContent: "center", alignItems: "center", padding: "12px" }}
        >
          <button onClick={table.prevPage} disabled={table.page === 0}>
            ← Prev
          </button>
          <span>
            {table.page + 1} / {table.totalPages}
          </span>
          <button onClick={table.nextPage} disabled={table.page >= table.totalPages - 1}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

// ─── ReactiveForm Types ──────────────────────────────────────────────────────

export interface ReactiveFormField {
  name: string
  label: string
  type: "text" | "number" | "email" | "textarea" | "select" | "checkbox" | "password" | "date"
  required?: boolean
  placeholder?: string
  options?: Array<{ value: string; label: string }>
  validate?: (value: unknown) => string | null
  defaultValue?: unknown
}

export interface ReactiveFormSchema {
  fields: ReactiveFormField[]
}

export interface ReactiveFormProps {
  schema?: ReactiveFormSchema
  mutation?: FunctionReference | string
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
  fields?: string[] | ReactiveFormField[]
  validation?: "schema" | "required" | "none"
  initialValues?: Record<string, unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
  submitLabel?: string
  resetOnSubmit?: boolean
  className?: string
}

// ─── HeadlessFormState ───────────────────────────────────────────────────────

export interface HeadlessFormState {
  values: Record<string, unknown>
  errors: Record<string, string>
  isSubmitting: boolean
  isDirty: boolean
  isValid: boolean
  fields: ReactiveFormField[]
  getValue: (name: string) => unknown
  setValue: (name: string, value: unknown) => void
  setValues: (values: Record<string, unknown>) => void
  getError: (name: string) => string | undefined
  handleSubmit: (e?: FormEvent) => Promise<void>
  reset: () => void
}

// ─── useReactiveForm ─────────────────────────────────────────────────────────

// Stable placeholder ref so useMutation is always called unconditionally
const NOOP_MUTATION_REF = { _name: "__noop__", _type: "mutation" as const }

/** Headless hook that returns all form state and helpers for custom rendering. */
export function useReactiveForm({
  schema,
  mutation,
  onSubmit,
  fields: fieldsProp,
  validation = "schema",
  initialValues = {},
  onSuccess,
  onError,
  resetOnSubmit = false,
}: Omit<ReactiveFormProps, "submitLabel" | "className">): HeadlessFormState {
  const resolvedFields = useMemo<ReactiveFormField[]>(() => {
    if (schema?.fields) {
      if (Array.isArray(fieldsProp) && fieldsProp.length > 0) {
        if (typeof fieldsProp[0] === "string") {
          const names = fieldsProp as string[]
          return schema.fields.filter((f) => names.includes(f.name))
        }
        return fieldsProp as ReactiveFormField[]
      }
      return schema.fields
    }
    if (Array.isArray(fieldsProp)) {
      return (fieldsProp as (string | ReactiveFormField)[]).map((f) =>
        typeof f === "string" ? { name: f, label: f, type: "text" as const } : f,
      )
    }
    return []
  }, [schema, fieldsProp])

  const defaults = useMemo(() => {
    const d: Record<string, unknown> = {}
    for (const f of resolvedFields) {
      d[f.name] = initialValues[f.name] ?? f.defaultValue ?? (f.type === "checkbox" ? false : "")
    }
    return d
  }, [resolvedFields, initialValues])

  const [values, setValuesState] = useState<Record<string, unknown>>(defaults)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  // Always call useMutation unconditionally to satisfy rules of hooks
  const mutationRef = mutation
    ? typeof mutation === "string"
      ? { _name: mutation, _type: "mutation" as const }
      : mutation
    : NOOP_MUTATION_REF
  const mutate = useMutation(mutationRef)
  const hasMutation = mutation != null

  const getValue = useCallback((name: string) => values[name], [values])

  const setValue = useCallback((name: string, value: unknown) => {
    setValuesState((v) => ({ ...v, [name]: value }))
    setIsDirty(true)
    setErrors((e) => {
      const next = { ...e }
      delete next[name]
      return next
    })
  }, [])

  const setValues = useCallback((newValues: Record<string, unknown>) => {
    setValuesState((v) => ({ ...v, ...newValues }))
    setIsDirty(true)
  }, [])

  const validate = useCallback((): Record<string, string> => {
    const newErrors: Record<string, string> = {}
    if (validation === "none") return newErrors
    for (const field of resolvedFields) {
      const val = values[field.name]
      if ((validation === "schema" || validation === "required") && field.required) {
        if (val === undefined || val === null || val === "") {
          newErrors[field.name] = `${field.label} is required`
        }
      }
      if (validation === "schema" && field.validate) {
        const err = field.validate(val)
        if (err) newErrors[field.name] = err
      }
    }
    return newErrors
  }, [resolvedFields, values, validation])

  const isValid = useMemo(() => Object.keys(validate()).length === 0, [validate])

  const getError = useCallback((name: string) => errors[name], [errors])

  const reset = useCallback(() => {
    setValuesState(defaults)
    setErrors({})
    setIsDirty(false)
  }, [defaults])

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      const newErrors = validate()
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors)
        return
      }
      try {
        setIsSubmitting(true)
        let result: unknown
        if (onSubmit) {
          result = await onSubmit(values)
        } else if (hasMutation) {
          result = await mutate(values)
        }
        onSuccess?.(result)
        if (resetOnSubmit) reset()
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        onError?.(error)
      } finally {
        setIsSubmitting(false)
      }
    },
    [values, validate, onSubmit, hasMutation, mutate, onSuccess, onError, resetOnSubmit, reset],
  )

  return {
    values,
    errors,
    isSubmitting,
    isDirty,
    isValid,
    fields: resolvedFields,
    getValue,
    setValue,
    setValues,
    getError,
    handleSubmit,
    reset,
  }
}

// ─── ReactiveForm Component ──────────────────────────────────────────────────

/** Auto-generated form bound to a mutation with schema validation. */
export function ReactiveForm(props: ReactiveFormProps): ReactNode {
  const { submitLabel = "Submit", className } = props
  const form = useReactiveForm(props)
  const { theme, classNamePrefix } = useTheme()

  return (
    <form
      onSubmit={form.handleSubmit}
      className={buildClassName(classNamePrefix, "form", theme.form?.container, className)}
    >
      {form.fields.map((field) => (
        <div
          key={field.name}
          className={buildClassName(classNamePrefix, "form-field", theme.form?.field)}
          style={{ marginBottom: "12px" }}
        >
          <label
            className={buildClassName(classNamePrefix, "form-label", theme.form?.label)}
            style={{ display: "block", marginBottom: "4px", fontWeight: 600 }}
          >
            {field.label}
            {field.required && <span style={{ color: "#ef4444", marginLeft: "2px" }}>*</span>}
          </label>

          {field.type === "textarea" ? (
            <textarea
              className={buildClassName(classNamePrefix, "form-input", theme.form?.input)}
              value={String(form.getValue(field.name) ?? "")}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => form.setValue(field.name, e.target.value)}
              placeholder={field.placeholder}
              style={{ width: "100%", padding: "6px", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          ) : field.type === "select" ? (
            <select
              className={buildClassName(classNamePrefix, "form-input", theme.form?.input)}
              value={String(form.getValue(field.name) ?? "")}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => form.setValue(field.name, e.target.value)}
              style={{ width: "100%", padding: "6px", border: "1px solid #ccc", borderRadius: "4px" }}
            >
              <option value="">Select...</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : field.type === "checkbox" ? (
            <input
              type="checkbox"
              checked={Boolean(form.getValue(field.name))}
              onChange={(e: ChangeEvent<HTMLInputElement>) => form.setValue(field.name, e.target.checked)}
            />
          ) : (
            <input
              className={buildClassName(classNamePrefix, "form-input", theme.form?.input)}
              type={field.type}
              value={String(form.getValue(field.name) ?? "")}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                form.setValue(field.name, field.type === "number" ? Number(e.target.value) : e.target.value)
              }
              placeholder={field.placeholder}
              style={{ width: "100%", padding: "6px", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          )}

          {form.getError(field.name) && (
            <span
              className={buildClassName(classNamePrefix, "form-error", theme.form?.error)}
              style={{ color: "#ef4444", fontSize: "12px", marginTop: "2px", display: "block" }}
            >
              {form.getError(field.name)}
            </span>
          )}
        </div>
      ))}

      <button
        type="submit"
        disabled={form.isSubmitting}
        className={buildClassName(classNamePrefix, "form-submit", theme.form?.submit)}
        style={{
          padding: "8px 16px",
          background: "#3b82f6",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: form.isSubmitting ? "not-allowed" : "pointer",
          opacity: form.isSubmitting ? 0.7 : 1,
        }}
      >
        {form.isSubmitting ? "Saving..." : submitLabel}
      </button>
    </form>
  )
}

// ─── ReactiveChart Types ─────────────────────────────────────────────────────

export type ChartType = "bar" | "line" | "pie"

export interface ReactiveChartProps {
  query: FunctionReference<unknown, Record<string, unknown>[]> | string
  args?: Record<string, unknown>
  type: ChartType
  xAxis: string
  yAxis: string
  realtime?: boolean
  width?: number | string
  height?: number
  colors?: string[]
  className?: string
  emptyMessage?: string
}

// ─── HeadlessChartState ──────────────────────────────────────────────────────

export interface ChartDataPoint {
  label: string
  value: number
  percentage?: number
  color: string
}

export interface HeadlessChartState {
  data: ChartDataPoint[]
  rawData: Record<string, unknown>[]
  isLoading: boolean
  type: ChartType
  maxValue: number
  totalValue: number
  xAxis: string
  yAxis: string
}

// ─── useReactiveChart ────────────────────────────────────────────────────────

const DEFAULT_CHART_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"]

/** Headless hook that returns processed chart data for custom rendering. */
export function useReactiveChart({
  query,
  args = {},
  type,
  xAxis,
  yAxis,
  colors = DEFAULT_CHART_COLORS,
}: Pick<ReactiveChartProps, "query" | "args" | "type" | "xAxis" | "yAxis" | "colors">): HeadlessChartState {
  const queryRef = typeof query === "string" ? { _name: query, _type: "query" as const } : query
  const rawData = useQuery(queryRef, args)
  const isLoading = rawData === undefined

  const items: Record<string, unknown>[] = useMemo(() => (Array.isArray(rawData) ? rawData : []), [rawData])

  const chartData = useMemo<ChartDataPoint[]>(() => {
    const total = items.reduce((sum, row) => sum + Number(row[yAxis] ?? 0), 0)
    return items.map((row, idx) => {
      const value = Number(row[yAxis] ?? 0)
      return {
        label: String(row[xAxis] ?? ""),
        value,
        percentage: total > 0 ? (value / total) * 100 : 0,
        color: colors[idx % colors.length],
      }
    })
  }, [items, xAxis, yAxis, colors])

  const maxValue = useMemo(() => Math.max(0, ...chartData.map((d) => d.value)), [chartData])
  const totalValue = useMemo(() => chartData.reduce((sum, d) => sum + d.value, 0), [chartData])

  return { data: chartData, rawData: items, isLoading, type, maxValue, totalValue, xAxis, yAxis }
}

// ─── ReactiveChart Component ─────────────────────────────────────────────────

/** Chart component bound to reactive queries with bar, line, and pie types. */
export function ReactiveChart(props: ReactiveChartProps): ReactNode {
  const { type, width = "100%", height = 300, className, emptyMessage = "No data" } = props
  const chart = useReactiveChart(props)
  const { theme, classNamePrefix } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  if (chart.isLoading) {
    return (
      <div className={buildClassName(classNamePrefix, "chart-loading", theme.chart?.container, className)}>
        Loading...
      </div>
    )
  }

  if (chart.data.length === 0) {
    return (
      <div
        className={buildClassName(classNamePrefix, "chart-empty", theme.chart?.container, className)}
        style={{ padding: "16px", textAlign: "center", opacity: 0.5 }}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={buildClassName(classNamePrefix, "chart", theme.chart?.container, className)}
      style={{ width, height, position: "relative" }}
    >
      {type === "bar" && (
        <BarChartRenderer chart={chart} height={height} classNamePrefix={classNamePrefix} theme={theme} />
      )}
      {type === "line" && (
        <LineChartRenderer
          chart={chart}
          height={height}
          containerWidth={containerWidth}
          classNamePrefix={classNamePrefix}
          theme={theme}
        />
      )}
      {type === "pie" && (
        <PieChartRenderer chart={chart} height={height} classNamePrefix={classNamePrefix} theme={theme} />
      )}
    </div>
  )
}

// ─── Chart Sub-renderers (internal) ──────────────────────────────────────────

function BarChartRenderer({
  chart,
  height,
  classNamePrefix,
  theme,
}: {
  chart: HeadlessChartState
  height: number
  classNamePrefix?: string
  theme: ReactiveComponentTheme
}): ReactNode {
  const barAreaHeight = height - 40

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "100%", padding: "0 8px" }}>
      {chart.data.map((point, idx) => {
        const barHeight = chart.maxValue > 0 ? (point.value / chart.maxValue) * barAreaHeight : 0
        return (
          <div
            key={idx}
            className={buildClassName(classNamePrefix, "chart-bar", theme.chart?.bar)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              height: "100%",
            }}
          >
            <span style={{ fontSize: "11px", marginBottom: "4px", color: "#6b7280" }}>{point.value}</span>
            <div
              style={{
                width: "100%",
                maxWidth: "60px",
                height: barHeight,
                backgroundColor: point.color,
                borderRadius: "4px 4px 0 0",
                transition: "height 0.3s ease",
              }}
            />
            <span
              className={buildClassName(classNamePrefix, "chart-label", theme.chart?.label)}
              style={{
                fontSize: "11px",
                marginTop: "4px",
                color: "#374151",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "60px",
                textAlign: "center",
              }}
            >
              {point.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function LineChartRenderer({
  chart,
  height,
  containerWidth,
  classNamePrefix,
  theme,
}: {
  chart: HeadlessChartState
  height: number
  containerWidth: number
  classNamePrefix?: string
  theme: ReactiveComponentTheme
}): ReactNode {
  const padding = 40
  const chartWidth = Math.max(containerWidth - padding * 2, 100)
  const chartHeight = height - padding * 2

  const points = chart.data.map((point, idx) => {
    const x = padding + (chart.data.length > 1 ? (idx / (chart.data.length - 1)) * chartWidth : chartWidth / 2)
    const y = padding + chartHeight - (chart.maxValue > 0 ? (point.value / chart.maxValue) * chartHeight : 0)
    return { x, y, ...point }
  })

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")

  return (
    <svg width="100%" height={height} style={{ overflow: "visible" }}>
      <path
        d={pathD}
        fill="none"
        stroke={chart.data[0]?.color ?? "#3b82f6"}
        strokeWidth={2}
        className={buildClassName(classNamePrefix, "chart-line", theme.chart?.line)}
      />
      {points.map((p, idx) => (
        <g key={idx}>
          <circle cx={p.x} cy={p.y} r={4} fill={p.color} />
          <text
            x={p.x}
            y={height - 8}
            textAnchor="middle"
            fontSize={11}
            fill="#374151"
            className={buildClassName(classNamePrefix, "chart-label", theme.chart?.label)}
          >
            {p.label}
          </text>
          <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={11} fill="#6b7280">
            {p.value}
          </text>
        </g>
      ))}
    </svg>
  )
}

function PieChartRenderer({
  chart,
  height,
  classNamePrefix,
  theme,
}: {
  chart: HeadlessChartState
  height: number
  classNamePrefix?: string
  theme: ReactiveComponentTheme
}): ReactNode {
  const size = Math.min(height, 300)
  const centerX = size / 2
  const centerY = size / 2
  const radius = size / 2 - 20

  let currentAngle = -Math.PI / 2
  const slices = chart.data.map((point) => {
    const angle = chart.totalValue > 0 ? (point.value / chart.totalValue) * Math.PI * 2 : 0
    const startAngle = currentAngle
    const endAngle = currentAngle + angle
    currentAngle = endAngle

    const x1 = centerX + radius * Math.cos(startAngle)
    const y1 = centerY + radius * Math.sin(startAngle)
    const x2 = centerX + radius * Math.cos(endAngle)
    const y2 = centerY + radius * Math.sin(endAngle)
    const largeArc = angle > Math.PI ? 1 : 0
    const d = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`

    const midAngle = startAngle + angle / 2
    const labelRadius = radius * 0.65
    const lx = centerX + labelRadius * Math.cos(midAngle)
    const ly = centerY + labelRadius * Math.sin(midAngle)

    return { ...point, d, lx, ly }
  })

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
      <svg width={size} height={size}>
        {slices.map((slice, idx) => (
          <g key={idx} className={buildClassName(classNamePrefix, "chart-pie-slice", theme.chart?.pie)}>
            <path d={slice.d} fill={slice.color} stroke="white" strokeWidth={2} />
            {(slice.percentage ?? 0) > 5 && (
              <text
                x={slice.lx}
                y={slice.ly}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fill="white"
                fontWeight={600}
              >
                {Math.round(slice.percentage ?? 0)}%
              </text>
            )}
          </g>
        ))}
      </svg>

      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {chart.data.map((point, idx) => (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
            <div style={{ width: 12, height: 12, borderRadius: "2px", backgroundColor: point.color, flexShrink: 0 }} />
            <span
              className={buildClassName(classNamePrefix, "chart-label", theme.chart?.label)}
              style={{ color: "#374151" }}
            >
              {point.label}: {point.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
