/**
 * Shared component utilities for framework-specific UI packages (Vue, Svelte).
 * Contains framework-agnostic logic for table sorting, form validation,
 * pagination, and presence visibility.
 */

// ─── Table Sorting ───────────────────────────────────────────────────────────

/**
 * Sort an array of records by a key with direction.
 * Uses string-based locale comparison for consistent cross-framework behavior.
 */
export function sortData(
  data: Record<string, unknown>[],
  key: string | null,
  dir: "asc" | "desc",
): Record<string, unknown>[] {
  if (!key) return data
  return [...data].sort((a, b) => {
    const cmp = String(a[key] ?? "").localeCompare(String(b[key] ?? ""))
    return dir === "asc" ? cmp : -cmp
  })
}

/**
 * Toggle sort state: same key flips direction, new key resets to asc.
 */
export function toggleSort(
  currentKey: string | null,
  currentDir: "asc" | "desc",
  newKey: string,
): { sortKey: string; sortDir: "asc" | "desc" } {
  if (currentKey === newKey) {
    return { sortKey: newKey, sortDir: currentDir === "asc" ? "desc" : "asc" }
  }
  return { sortKey: newKey, sortDir: "asc" }
}

// ─── Pagination ──────────────────────────────────────────────────────────────

/**
 * Calculate pagination state from a data array.
 */
export function paginate<T>(data: T[], page: number, pageSize: number): { rows: T[]; totalPages: number } {
  const totalPages = Math.ceil(data.length / pageSize)
  const rows = data.slice(page * pageSize, (page + 1) * pageSize)
  return { rows, totalPages }
}

/**
 * Clamp a page number to valid bounds.
 */
export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 0
  return Math.max(0, Math.min(page, totalPages - 1))
}

// ─── Form Validation ─────────────────────────────────────────────────────────

export interface FormField {
  name: string
  label: string
  required?: boolean
  validate?: (value: unknown) => string | null
}

/**
 * Validate form values against field definitions.
 * Returns a map of field names to error messages, or an empty object if valid.
 */
export function validateFields(fields: FormField[], values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    if (field.required && !values[field.name]) {
      errors[field.name] = `${field.label} is required`
    }
    if (field.validate) {
      const err = field.validate(values[field.name])
      if (err) errors[field.name] = err
    }
  }
  return errors
}

// ─── Presence Visibility ─────────────────────────────────────────────────────

export interface PresenceUser {
  id: string
  name: string
  avatar?: string
  color?: string
}

/**
 * Compute visible users and overflow count.
 */
export function computePresenceVisibility<T extends PresenceUser>(
  users: T[],
  maxVisible: number,
): { visible: T[]; overflow: number } {
  return {
    visible: users.slice(0, maxVisible),
    overflow: Math.max(0, users.length - maxVisible),
  }
}
