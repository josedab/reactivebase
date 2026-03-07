/**
 * ReactiveBase Vue composables for CRDT-backed collaboration.
 * Provides useCollabText, useCollabList, useCollabMap, useCollabCounter,
 * useCursors, and useTypingUsers for real-time collaborative data structures.
 *
 * Usage:
 *   const { text, insert, deleteRange } = useCollabText("doc-1")
 *   const { items, push, remove } = useCollabList<string>("shopping-list")
 *   const { entries, set, get } = useCollabMap<string>("settings")
 *   const { value, increment, decrement } = useCollabCounter("likes")
 *   const { cursors, updateCursor, clearCursor } = useCursors("room-1")
 *   const { typingUsers, setTyping } = useTypingUsers("room-1")
 */

import { ref, computed, onMounted, onUnmounted, type Ref, type ComputedRef } from "vue"
import { useReactiveBaseClient } from "./index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CursorData {
  connectionId: string
  userId: string
  userName: string
  color: string
  x: number
  y: number
  target?: string
}

export interface TypingUser {
  connectionId: string
  userId: string
  userName: string
}

export interface UseCollabTextReturn {
  /** Current text content */
  text: Ref<string>
  /** Insert text at a position */
  insert: (index: number, text: string) => void
  /** Delete text at a position */
  deleteRange: (index: number, length: number) => void
  /** Replace all text */
  setText: (text: string) => void
  /** Text length */
  length: ComputedRef<number>
  /** Whether the document is loading */
  loading: Ref<boolean>
  /** Connection status */
  connected: Ref<boolean>
}

export interface UseCollabListReturn<T> {
  /** Current items */
  items: Ref<T[]>
  /** Add an item */
  push: (item: T) => void
  /** Remove an item */
  remove: (item: T) => void
  /** Check if item exists */
  has: (item: T) => boolean
  /** Item count */
  length: ComputedRef<number>
  /** Whether the list is loading */
  loading: Ref<boolean>
}

export interface UseCollabMapReturn<T> {
  /** Current entries */
  entries: Ref<Record<string, T>>
  /** Get a value by key */
  get: (key: string) => T | undefined
  /** Set a key-value pair */
  set: (key: string, value: T) => void
  /** Delete a key */
  deleteKey: (key: string) => void
  /** All keys */
  keys: ComputedRef<string[]>
  /** Whether the map is loading */
  loading: Ref<boolean>
}

export interface UseCollabCounterReturn {
  /** Current counter value */
  value: Ref<number>
  /** Increment the counter */
  increment: (amount?: number) => void
  /** Decrement the counter */
  decrement: (amount?: number) => void
  /** Whether the counter is loading */
  loading: Ref<boolean>
}

export interface UseCursorsReturn {
  /** Remote cursors */
  cursors: Ref<CursorData[]>
  /** Broadcast local cursor position */
  updateCursor: (position: { x: number; y: number; target?: string }) => void
  /** Remove local cursor */
  clearCursor: () => void
}

export interface UseTypingUsersReturn {
  /** Users currently typing */
  typingUsers: Ref<TypingUser[]>
  /** Toggle local typing state */
  setTyping: (isTyping: boolean) => void
}

// ─── useCollabText ───────────────────────────────────────────────────────────

/**
 * Composable for CRDT-backed collaborative text editing.
 *
 * @param docId - Unique identifier for the collaborative document
 * @returns A {@link UseCollabTextReturn} with reactive text, insert/delete/set operations, and loading state
 */
export function useCollabText(docId: string): UseCollabTextReturn {
  const client = useReactiveBaseClient()
  const text = ref("")
  const loading = ref(true)
  const connected = ref(false)

  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    unsubscribe = client.subscribe(`__collab_text_${docId}`, { docId }, (result, err) => {
      if (!err && typeof result === "string") {
        text.value = result
      } else if (!err && result && typeof result === "object" && "text" in (result as Record<string, unknown>)) {
        text.value = (result as { text: string }).text
      }
      loading.value = false
      connected.value = true
    })

    loading.value = false
    connected.value = true
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  const insert = (index: number, insertText: string) => {
    text.value = text.value.slice(0, index) + insertText + text.value.slice(index)
    client.mutate("__collab_text_insert", { docId, index, text: insertText })
  }

  const deleteRange = (index: number, length: number) => {
    text.value = text.value.slice(0, index) + text.value.slice(index + length)
    client.mutate("__collab_text_delete", { docId, index, length })
  }

  const setText = (newText: string) => {
    text.value = newText
    client.mutate("__collab_text_set", { docId, text: newText })
  }

  const length = computed(() => text.value.length)

  return { text, insert, deleteRange, setText, length, loading, connected }
}

// ─── useCollabList ───────────────────────────────────────────────────────────

/**
 * Composable for CRDT-backed collaborative lists.
 *
 * @param docId - Unique identifier for the collaborative list
 * @returns A {@link UseCollabListReturn} with reactive items, push/remove operations, and loading state
 */
export function useCollabList<T = unknown>(docId: string): UseCollabListReturn<T> {
  const client = useReactiveBaseClient()
  const items = ref<T[]>([]) as Ref<T[]>
  const loading = ref(true)

  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    unsubscribe = client.subscribe(`__collab_list_${docId}`, { docId }, (result, err) => {
      if (!err && Array.isArray(result)) {
        items.value = result as T[]
      }
      loading.value = false
    })

    loading.value = false
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  const push = (item: T) => {
    items.value = [...items.value, item]
    client.mutate("__collab_list_push", { docId, item })
  }

  const remove = (item: T) => {
    items.value = items.value.filter((i) => i !== item)
    client.mutate("__collab_list_remove", { docId, item })
  }

  const has = (item: T) => items.value.includes(item)

  const length = computed(() => items.value.length)

  return { items, push, remove, has, length, loading }
}

// ─── useCollabMap ────────────────────────────────────────────────────────────

/**
 * Composable for CRDT-backed collaborative maps.
 *
 * @param docId - Unique identifier for the collaborative map
 * @returns A {@link UseCollabMapReturn} with reactive entries, get/set/delete operations, and loading state
 */
export function useCollabMap<T = unknown>(docId: string): UseCollabMapReturn<T> {
  const client = useReactiveBaseClient()
  const entries = ref<Record<string, T>>({}) as Ref<Record<string, T>>
  const loading = ref(true)

  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    unsubscribe = client.subscribe(`__collab_map_${docId}`, { docId }, (result, err) => {
      if (!err && result && typeof result === "object") {
        entries.value = result as Record<string, T>
      }
      loading.value = false
    })

    loading.value = false
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  const get = (key: string) => entries.value[key]

  const set = (key: string, value: T) => {
    entries.value = { ...entries.value, [key]: value }
    client.mutate("__collab_map_set", { docId, key, value })
  }

  const deleteKey = (key: string) => {
    const next = { ...entries.value }
    delete next[key]
    entries.value = next
    client.mutate("__collab_map_delete", { docId, key })
  }

  const keys = computed(() => Object.keys(entries.value))

  return { entries, get, set, deleteKey, keys, loading }
}

// ─── useCollabCounter ────────────────────────────────────────────────────────

/**
 * Composable for CRDT-backed collaborative counters.
 *
 * @param docId - Unique identifier for the collaborative counter
 * @returns A {@link UseCollabCounterReturn} with reactive value, increment/decrement operations, and loading state
 */
export function useCollabCounter(docId: string): UseCollabCounterReturn {
  const client = useReactiveBaseClient()
  const value = ref(0)
  const loading = ref(true)

  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    unsubscribe = client.subscribe(`__collab_counter_${docId}`, { docId }, (result, err) => {
      if (!err && typeof result === "number") {
        value.value = result
      }
      loading.value = false
    })

    loading.value = false
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  const increment = (amount = 1) => {
    value.value += amount
    client.mutate("__collab_counter_increment", { docId, amount })
  }

  const decrement = (amount = 1) => {
    value.value -= amount
    client.mutate("__collab_counter_decrement", { docId, amount })
  }

  return { value, increment, decrement, loading }
}

// ─── useCursors ──────────────────────────────────────────────────────────────

/**
 * Composable for real-time cursor awareness in a collaboration room.
 * Returns the list of remote cursors and a function to broadcast local cursor.
 *
 * @param roomId - Unique identifier for the collaboration room
 * @returns A {@link UseCursorsReturn} with reactive cursors, updateCursor, and clearCursor
 */
export function useCursors(roomId: string): UseCursorsReturn {
  const client = useReactiveBaseClient()
  const cursors = ref<CursorData[]>([])

  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    unsubscribe = client.subscribe(`__collab:cursors:${roomId}`, { roomId }, (result) => {
      if (Array.isArray(result)) {
        cursors.value = result as CursorData[]
      }
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  const updateCursor = (position: { x: number; y: number; target?: string }) => {
    client.mutate("__collab:updateCursor", { roomId, ...position })
  }

  const clearCursor = () => {
    client.mutate("__collab:clearCursor", { roomId })
  }

  return { cursors, updateCursor, clearCursor }
}

// ─── useTypingUsers ──────────────────────────────────────────────────────────

/**
 * Composable for typing indicator awareness.
 * Tracks which users are currently typing in a room.
 *
 * @param roomId - Unique identifier for the collaboration room
 * @returns A {@link UseTypingUsersReturn} with reactive typingUsers and setTyping toggle
 */
export function useTypingUsers(roomId: string): UseTypingUsersReturn {
  const client = useReactiveBaseClient()
  const typingUsers = ref<TypingUser[]>([])

  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    unsubscribe = client.subscribe(`__collab:typing:${roomId}`, { roomId }, (result) => {
      if (Array.isArray(result)) {
        typingUsers.value = result as TypingUser[]
      }
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  const setTyping = (isTyping: boolean) => {
    client.mutate("__collab:setTyping", { roomId, isTyping })
  }

  return { typingUsers, setTyping }
}
