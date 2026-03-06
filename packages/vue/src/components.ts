/**
 * Cross-Framework Reactive UI Components for Vue 3.
 * Renderless composables for ReactiveTable, ReactiveForm, and PresenceAvatars
 * that return reactive data for template binding.
 *
 * Usage:
 *   const { rows, sort, page, totalPages } = useReactiveTable({ query: "tasks.list", columns: [...] })
 *   const { values, errors, submit } = useReactiveForm({ mutation: "tasks.create", fields: [...] })
 *   const { users, overflow } = usePresenceAvatars({ query: "presence.list" })
 */

import { ref, computed, type Ref } from "vue"
import { useQuery, useMutation } from "./index.js"
import { sortData, toggleSort, paginate, validateFields, computePresenceVisibility } from "@reactivebase/client"

// ─── ReactiveTable Composable ────────────────────────────────────────────────

export interface VueTableColumn {
  key: string
  header: string
  sortable?: boolean
}

export interface UseReactiveTableOptions {
  query: string
  args?: Record<string, unknown>
  columns: VueTableColumn[]
  pageSize?: number
}

export interface UseReactiveTableReturn {
  rows: Ref<Record<string, unknown>[]>
  isLoading: Ref<boolean>
  sortKey: Ref<string | null>
  sortDir: Ref<"asc" | "desc">
  page: Ref<number>
  totalPages: Ref<number>
  sort: (key: string) => void
  nextPage: () => void
  prevPage: () => void
}

export function useReactiveTable(options: UseReactiveTableOptions): UseReactiveTableReturn {
  const queryRef = { _name: options.query, _type: "query" as const }
  const { data, isLoading } = useQuery(queryRef, options.args ?? {})

  const sortKey = ref<string | null>(null)
  const sortDir = ref<"asc" | "desc">("asc")
  const page = ref(0)
  const pageSize = options.pageSize ?? 20

  const sorted = computed(() => {
    const items = Array.isArray(data.value) ? [...data.value] : []
    return sortData(items, sortKey.value, sortDir.value) as Record<string, unknown>[]
  })

  const totalPages = computed(() => Math.ceil(sorted.value.length / pageSize))

  const rows = computed(() => {
    return paginate(sorted.value, page.value, pageSize).rows
  })

  function sort(key: string): void {
    const result = toggleSort(sortKey.value, sortDir.value, key)
    sortKey.value = result.sortKey
    sortDir.value = result.sortDir
  }

  function nextPage(): void {
    if (page.value < totalPages.value - 1) page.value++
  }

  function prevPage(): void {
    if (page.value > 0) page.value--
  }

  return { rows, isLoading, sortKey, sortDir, page, totalPages, sort, nextPage, prevPage }
}

// ─── ReactiveForm Composable ─────────────────────────────────────────────────

export interface VueFormField {
  name: string
  label: string
  type: "text" | "number" | "email" | "textarea" | "select" | "checkbox"
  required?: boolean
  validate?: (value: unknown) => string | null
  options?: Array<{ value: string; label: string }>
}

export interface UseReactiveFormOptions {
  mutation: string
  fields: VueFormField[]
  initialValues?: Record<string, unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

export interface UseReactiveFormReturn {
  values: Ref<Record<string, unknown>>
  errors: Ref<Record<string, string>>
  isSubmitting: Ref<boolean>
  setValue: (name: string, value: unknown) => void
  submit: () => Promise<void>
  reset: () => void
}

export function useReactiveForm(options: UseReactiveFormOptions): UseReactiveFormReturn {
  const mutationRef = { _name: options.mutation, _type: "mutation" as const }
  const { mutate } = useMutation(mutationRef)
  const values = ref<Record<string, unknown>>({ ...options.initialValues })
  const errors = ref<Record<string, string>>({})
  const isSubmitting = ref(false)

  function setValue(name: string, value: unknown): void {
    values.value = { ...values.value, [name]: value }
    const newErrors = { ...errors.value }
    delete newErrors[name]
    errors.value = newErrors
  }

  async function submit(): Promise<void> {
    const newErrors = validateFields(options.fields, values.value)

    if (Object.keys(newErrors).length > 0) {
      errors.value = newErrors
      return
    }

    isSubmitting.value = true
    try {
      const result = await mutate(values.value)
      options.onSuccess?.(result)
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err))
      options.onError?.(error)
    } finally {
      isSubmitting.value = false
    }
  }

  function reset(): void {
    values.value = { ...options.initialValues }
    errors.value = {}
  }

  return { values, errors, isSubmitting, setValue, submit, reset }
}

// ─── PresenceAvatars Composable ──────────────────────────────────────────────

export interface VuePresenceUser {
  id: string
  name: string
  avatar?: string
  color?: string
}

export interface UsePresenceAvatarsOptions {
  query: string
  args?: Record<string, unknown>
  maxVisible?: number
}

export interface UsePresenceAvatarsReturn {
  users: Ref<VuePresenceUser[]>
  visible: Ref<VuePresenceUser[]>
  overflow: Ref<number>
  isLoading: Ref<boolean>
}

export function usePresenceAvatars(options: UsePresenceAvatarsOptions): UsePresenceAvatarsReturn {
  const queryRef = { _name: options.query, _type: "query" as const }
  const { data, isLoading } = useQuery(queryRef, options.args ?? {})
  const maxVisible = options.maxVisible ?? 5

  const users = computed(() => (Array.isArray(data.value) ? data.value : []) as VuePresenceUser[])
  const presence = computed(() => computePresenceVisibility(users.value, maxVisible))
  const visible = computed(() => presence.value.visible)
  const overflow = computed(() => presence.value.overflow)

  return { users, visible, overflow, isLoading }
}
