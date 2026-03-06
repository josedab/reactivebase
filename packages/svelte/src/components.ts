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
import { sortData, toggleSort, paginate, validateFields, computePresenceVisibility } from "@reactivebase/client"

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
    const sorted = sortData(latestData, sortKey, sortDir) as Record<string, unknown>[]
    const { rows, totalPages } = paginate(sorted, page, pageSize)

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
      const result = toggleSort(sortKey, sortDir, key)
      sortKey = result.sortKey
      sortDir = result.sortDir
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
      const newErrors = validateFields(options.fields, values)

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
        const { visible, overflow } = computePresenceVisibility(users, maxVisible)
        run({
          users,
          visible,
          overflow,
          isLoading: storeValue.isLoading,
        })
      })
    },
  }
}
