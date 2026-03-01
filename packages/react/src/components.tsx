/**
 * Cross-Framework Reactive UI Components for React.
 * Pre-built components with automatic data binding to ReactiveBase queries and mutations.
 *
 * Components:
 *   - ReactiveTable: Data table with sorting, pagination, and live updates
 *   - ReactiveForm: Form with auto-save and validation bound to mutations
 *   - PresenceAvatars: User presence indicators with cursor tracking
 */

import { useState, useCallback, useMemo, createElement, type FormEvent, type ChangeEvent, type ReactNode } from "react"
import { useQuery, useMutation } from "./hooks/index.js"
import type { FunctionReference } from "./hooks/index.js"

// ─── ReactiveTable ───────────────────────────────────────────────────────────

export interface ReactiveTableColumn<T = Record<string, unknown>> {
  key: string
  header: string
  render?: (value: unknown, row: T) => ReactNode
  sortable?: boolean
  width?: string | number
}

export interface ReactiveTableProps<T = Record<string, unknown>> {
  query: FunctionReference<unknown, T[]> | string
  args?: Record<string, unknown>
  columns: ReactiveTableColumn<T>[]
  pageSize?: number
  sortable?: boolean
  onRowClick?: (row: T) => void
  emptyMessage?: string
  className?: string
  rowKey?: string
}

export function ReactiveTable<T extends Record<string, unknown>>({
  query,
  args = {},
  columns,
  pageSize = 20,
  sortable = true,
  onRowClick,
  emptyMessage = "No data",
  className,
  rowKey = "id",
}: ReactiveTableProps<T>): ReactNode {
  const queryRef = typeof query === "string" ? { _name: query, _type: "query" as const } : query
  const data = useQuery(queryRef, args)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!data || !Array.isArray(data)) return []
    const items = [...data] as T[]
    if (sortKey) {
      items.sort((a, b) => {
        const av = a[sortKey]
        const bv = b[sortKey]
        const cmp = String(av ?? "").localeCompare(String(bv ?? ""))
        return sortDir === "asc" ? cmp : -cmp
      })
    }
    return items
  }, [data, sortKey, sortDir])

  const paged = useMemo(() => {
    return sorted.slice(page * pageSize, (page + 1) * pageSize)
  }, [sorted, page, pageSize])

  const totalPages = Math.ceil(sorted.length / pageSize)

  const handleSort = useCallback(
    (key: string) => {
      if (!sortable) return
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"))
      } else {
        setSortKey(key)
        setSortDir("asc")
      }
    },
    [sortKey, sortable],
  )

  if (data === undefined) {
    return createElement("div", { className }, "Loading...")
  }

  return createElement(
    "div",
    { className },
    createElement(
      "table",
      { style: { width: "100%", borderCollapse: "collapse" } },
      createElement(
        "thead",
        null,
        createElement(
          "tr",
          null,
          columns.map((col) =>
            createElement(
              "th",
              {
                key: col.key,
                onClick: col.sortable !== false ? () => handleSort(col.key) : undefined,
                style: {
                  cursor: col.sortable !== false && sortable ? "pointer" : "default",
                  padding: "8px",
                  textAlign: "left" as const,
                  borderBottom: "2px solid #e2e8f0",
                  width: col.width,
                },
              },
              col.header,
              sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : "",
            ),
          ),
        ),
      ),
      createElement(
        "tbody",
        null,
        paged.length === 0
          ? createElement(
              "tr",
              null,
              createElement(
                "td",
                { colSpan: columns.length, style: { padding: "16px", textAlign: "center" as const, opacity: 0.5 } },
                emptyMessage,
              ),
            )
          : paged.map((row, idx) =>
              createElement(
                "tr",
                {
                  key: ((row as Record<string, unknown>)[rowKey] as string) ?? idx,
                  onClick: onRowClick ? () => onRowClick(row) : undefined,
                  style: { cursor: onRowClick ? "pointer" : "default", borderBottom: "1px solid #e2e8f0" },
                },
                columns.map((col) =>
                  createElement(
                    "td",
                    { key: col.key, style: { padding: "8px" } },
                    col.render
                      ? col.render((row as Record<string, unknown>)[col.key], row)
                      : String((row as Record<string, unknown>)[col.key] ?? ""),
                  ),
                ),
              ),
            ),
      ),
    ),
    totalPages > 1 &&
      createElement(
        "div",
        { style: { display: "flex", gap: "8px", justifyContent: "center", padding: "12px" } },
        createElement("button", { onClick: () => setPage((p) => Math.max(0, p - 1)), disabled: page === 0 }, "← Prev"),
        createElement("span", null, `${page + 1} / ${totalPages}`),
        createElement(
          "button",
          { onClick: () => setPage((p) => Math.min(totalPages - 1, p + 1)), disabled: page >= totalPages - 1 },
          "Next →",
        ),
      ),
  )
}

// ─── ReactiveForm ────────────────────────────────────────────────────────────

export interface ReactiveFormField {
  name: string
  label: string
  type: "text" | "number" | "email" | "textarea" | "select" | "checkbox"
  required?: boolean
  placeholder?: string
  options?: Array<{ value: string; label: string }>
  validate?: (value: unknown) => string | null
}

export interface ReactiveFormProps {
  mutation: FunctionReference | string
  fields: ReactiveFormField[]
  initialValues?: Record<string, unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
  submitLabel?: string
  className?: string
}

export function ReactiveForm({
  mutation,
  fields,
  initialValues = {},
  onSuccess,
  onError,
  submitLabel = "Submit",
  className,
}: ReactiveFormProps): ReactNode {
  const mutationRef = typeof mutation === "string" ? { _name: mutation, _type: "mutation" as const } : mutation
  const mutate = useMutation(mutationRef)
  const [isLoading, setIsLoading] = useState(false)
  const [values, setValues] = useState<Record<string, unknown>>({ ...initialValues })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = useCallback((name: string, value: unknown) => {
    setValues((v) => ({ ...v, [name]: value }))
    setErrors((e) => {
      const next = { ...e }
      delete next[name]
      return next
    })
  }, [])

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()

      // Validate
      const newErrors: Record<string, string> = {}
      for (const field of fields) {
        if (field.required && !values[field.name]) {
          newErrors[field.name] = `${field.label} is required`
        }
        if (field.validate) {
          const err = field.validate(values[field.name])
          if (err) newErrors[field.name] = err
        }
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors)
        return
      }

      try {
        setIsLoading(true)
        const result = await mutate(values)
        onSuccess?.(result)
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        onError?.(error)
      } finally {
        setIsLoading(false)
      }
    },
    [fields, values, mutate, onSuccess, onError],
  )

  return createElement(
    "form",
    { onSubmit: handleSubmit, className },
    fields.map((field) =>
      createElement(
        "div",
        { key: field.name, style: { marginBottom: "12px" } },
        createElement("label", { style: { display: "block", marginBottom: "4px", fontWeight: 600 } }, field.label),
        field.type === "textarea"
          ? createElement("textarea", {
              value: String(values[field.name] ?? ""),
              onChange: (e: ChangeEvent<HTMLTextAreaElement>) => handleChange(field.name, e.target.value),
              placeholder: field.placeholder,
              style: { width: "100%", padding: "6px", border: "1px solid #ccc", borderRadius: "4px" },
            })
          : field.type === "select"
            ? createElement(
                "select",
                {
                  value: String(values[field.name] ?? ""),
                  onChange: (e: ChangeEvent<HTMLSelectElement>) => handleChange(field.name, e.target.value),
                  style: { width: "100%", padding: "6px", border: "1px solid #ccc", borderRadius: "4px" },
                },
                field.options?.map((opt) => createElement("option", { key: opt.value, value: opt.value }, opt.label)),
              )
            : field.type === "checkbox"
              ? createElement("input", {
                  type: "checkbox",
                  checked: Boolean(values[field.name]),
                  onChange: (e: ChangeEvent<HTMLInputElement>) => handleChange(field.name, e.target.checked),
                })
              : createElement("input", {
                  type: field.type,
                  value: String(values[field.name] ?? ""),
                  onChange: (e: ChangeEvent<HTMLInputElement>) =>
                    handleChange(field.name, field.type === "number" ? Number(e.target.value) : e.target.value),
                  placeholder: field.placeholder,
                  style: { width: "100%", padding: "6px", border: "1px solid #ccc", borderRadius: "4px" },
                }),
        errors[field.name] && createElement("span", { style: { color: "red", fontSize: "12px" } }, errors[field.name]),
      ),
    ),
    createElement(
      "button",
      {
        type: "submit",
        disabled: isLoading,
        style: {
          padding: "8px 16px",
          background: "#3b82f6",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        },
      },
      isLoading ? "Saving..." : submitLabel,
    ),
  )
}

// ─── PresenceAvatars ─────────────────────────────────────────────────────────

export interface PresenceUser {
  id: string
  name: string
  avatar?: string
  color?: string
}

export interface PresenceAvatarsProps {
  query: FunctionReference | string
  args?: Record<string, unknown>
  maxVisible?: number
  size?: number
  className?: string
}

export function PresenceAvatars({
  query,
  args = {},
  maxVisible = 5,
  size = 32,
  className,
}: PresenceAvatarsProps): ReactNode {
  const queryRef = typeof query === "string" ? { _name: query, _type: "query" as const } : query
  const data = useQuery(queryRef, args)

  const users: PresenceUser[] = Array.isArray(data) ? data : []
  const visible = users.slice(0, maxVisible)
  const overflow = users.length - maxVisible

  const colors = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"]

  return createElement(
    "div",
    { className, style: { display: "flex", alignItems: "center" } },
    visible.map((user, idx) =>
      createElement(
        "div",
        {
          key: user.id,
          title: user.name,
          style: {
            width: size,
            height: size,
            borderRadius: "50%",
            backgroundColor: user.color ?? colors[idx % colors.length],
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: size * 0.4,
            fontWeight: 600,
            marginLeft: idx > 0 ? -size * 0.25 : 0,
            border: "2px solid white",
            overflow: "hidden" as const,
          },
        },
        user.avatar
          ? createElement("img", {
              src: user.avatar,
              alt: user.name,
              style: { width: "100%", height: "100%", objectFit: "cover" as const },
            })
          : user.name.charAt(0).toUpperCase(),
      ),
    ),
    overflow > 0 &&
      createElement(
        "div",
        {
          style: {
            width: size,
            height: size,
            borderRadius: "50%",
            backgroundColor: "#6b7280",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: size * 0.35,
            fontWeight: 600,
            marginLeft: -size * 0.25,
            border: "2px solid white",
          },
        },
        `+${overflow}`,
      ),
  )
}
