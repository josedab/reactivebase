/**
 * Cross-Framework Reactive UI Components for Svelte.
 * Store-based composables for ReactiveTable, ReactiveForm, and PresenceAvatars.
 *
 * Usage:
 *   const table = reactiveTableStore({ query: "tasks.list", columns: [...] })
 *   $: ({ rows, page, totalPages } = $table)
 *
 *   const form = reactiveFormStore({ mutation: "tasks.create", fields: [...] })
 *   $form.submit()
 */

import { queryStore, createMutation } from "./index.js"
import type { Readable } from "./index.js"

// ─── ReactiveTable Store ─────────────────────────────────────────────────────

export interface SvelteTableColumn {
  key: string
  header: string
  sortable?: boolean
}

export interface ReactiveTableStoreOptions {
  query: string
  args?: Record<string, unknown>
  columns: SvelteTableColumn[]
  pageSize?: number
}

export interface ReactiveTableState {
  rows: Record<string, unknown>[]
  isLoading: boolean
  error: Error | null
  sortKey: string | null
  sortDir: "asc" | "desc"
  page: number
  totalPages: number
  totalRows: number
}

export interface ReactiveTableActions {
  sort: (key: string) => void
  nextPage: () => void
  prevPage: () => void
  goToPage: (page: number) => void
}

export type ReactiveTableStore = Readable<ReactiveTableState> & ReactiveTableActions

export function reactiveTableStore(options: ReactiveTableStoreOptions): ReactiveTableStore {
  const store = queryStore<Record<string, unknown>[]>(options.query, options.args)
  const pageSize = options.pageSize ?? 20

  let sortKey: string | null = null
  let sortDir: "asc" | "desc" = "asc"
  let page = 0
  let subscribers: Array<(value: ReactiveTableState) => void> = []
  let latestData: Record<string, unknown>[] = []
  let isLoading = true
  let error: Error | null = null

  function notify(): void {
    const sorted = sortData(latestData, sortKey, sortDir)
    const totalPages = Math.ceil(sorted.length / pageSize)
    const rows = sorted.slice(page * pageSize, (page + 1) * pageSize)

    const state: ReactiveTableState = {
      rows,
      isLoading,
      error,
      sortKey,
      sortDir,
      page,
      totalPages,
      totalRows: sorted.length,
    }

    for (const fn of subscribers) fn(state)
  }

  const actions: ReactiveTableActions = {
    sort(key: string): void {
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc"
      } else {
        sortKey = key
        sortDir = "asc"
      }
      notify()
    },
    nextPage(): void {
      const totalPages = Math.ceil(latestData.length / pageSize)
      if (page < totalPages - 1) {
        page++
        notify()
      }
    },
    prevPage(): void {
      if (page > 0) {
        page--
        notify()
      }
    },
    goToPage(p: number): void {
      const totalPages = Math.ceil(latestData.length / pageSize)
      if (p >= 0 && p < totalPages) {
        page = p
        notify()
      }
    },
  }

  return {
    subscribe(run: (value: ReactiveTableState) => void): () => void {
      subscribers.push(run)

      const unsub = store.subscribe((storeValue) => {
        latestData = storeValue.data ?? []
        isLoading = storeValue.isLoading
        error = storeValue.error
        notify()
      })

      return () => {
        subscribers = subscribers.filter((s) => s !== run)
        unsub()
      }
    },
    ...actions,
  }
}

// ─── ReactiveForm Store ──────────────────────────────────────────────────────

export interface SvelteFormField {
  name: string
  label: string
  type: "text" | "number" | "email" | "textarea" | "select" | "checkbox"
  required?: boolean
  validate?: (value: unknown) => string | null
  options?: Array<{ value: string; label: string }>
}

export interface ReactiveFormStoreOptions {
  mutation: string
  fields: SvelteFormField[]
  initialValues?: Record<string, unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

export interface ReactiveFormState {
  values: Record<string, unknown>
  errors: Record<string, string>
  isSubmitting: boolean
}

export interface ReactiveFormActions {
  setValue: (name: string, value: unknown) => void
  submit: () => Promise<void>
  reset: () => void
}

export type ReactiveFormStore = Readable<ReactiveFormState> & ReactiveFormActions

export function reactiveFormStore(options: ReactiveFormStoreOptions): ReactiveFormStore {
  let values: Record<string, unknown> = { ...options.initialValues }
  let errors: Record<string, string> = {}
  let isSubmitting = false
  let subscribers: Array<(value: ReactiveFormState) => void> = []
  const mutation = createMutation(options.mutation)

  function notify(): void {
    const state: ReactiveFormState = { values: { ...values }, errors: { ...errors }, isSubmitting }
    for (const fn of subscribers) fn(state)
  }

  const actions: ReactiveFormActions = {
    setValue(name: string, value: unknown): void {
      values = { ...values, [name]: value }
      delete errors[name]
      errors = { ...errors }
      notify()
    },

    async submit(): Promise<void> {
      const newErrors: Record<string, string> = {}
      for (const field of options.fields) {
        if (field.required && !values[field.name]) {
          newErrors[field.name] = `${field.label} is required`
        }
        if (field.validate) {
          const err = field.validate(values[field.name])
          if (err) newErrors[field.name] = err
        }
      }

      if (Object.keys(newErrors).length > 0) {
        errors = newErrors
        notify()
        return
      }

      isSubmitting = true
      notify()

      try {
        const result = await mutation.mutate(values)
        options.onSuccess?.(result)
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        options.onError?.(error)
      } finally {
        isSubmitting = false
        notify()
      }
    },

    reset(): void {
      values = { ...options.initialValues }
      errors = {}
      notify()
    },
  }

  return {
    subscribe(run: (value: ReactiveFormState) => void): () => void {
      subscribers.push(run)
      run({ values: { ...values }, errors: { ...errors }, isSubmitting })
      return () => {
        subscribers = subscribers.filter((s) => s !== run)
      }
    },
    ...actions,
  }
}

// ─── PresenceAvatars Store ───────────────────────────────────────────────────

export interface SveltePresenceUser {
  id: string
  name: string
  avatar?: string
  color?: string
}

export interface PresenceAvatarsStoreOptions {
  query: string
  args?: Record<string, unknown>
  maxVisible?: number
}

export interface PresenceAvatarsState {
  users: SveltePresenceUser[]
  visible: SveltePresenceUser[]
  overflow: number
  isLoading: boolean
}

export function presenceAvatarsStore(options: PresenceAvatarsStoreOptions): Readable<PresenceAvatarsState> {
  const store = queryStore<SveltePresenceUser[]>(options.query, options.args)
  const maxVisible = options.maxVisible ?? 5

  return {
    subscribe(run: (value: PresenceAvatarsState) => void): () => void {
      return store.subscribe((storeValue) => {
        const users = storeValue.data ?? []
        run({
          users,
          visible: users.slice(0, maxVisible),
          overflow: Math.max(0, users.length - maxVisible),
          isLoading: storeValue.isLoading,
        })
      })
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sortData(data: Record<string, unknown>[], key: string | null, dir: "asc" | "desc"): Record<string, unknown>[] {
  if (!key) return data
  return [...data].sort((a, b) => {
    const cmp = String(a[key] ?? "").localeCompare(String(b[key] ?? ""))
    return dir === "asc" ? cmp : -cmp
  })
}
