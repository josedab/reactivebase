/**
 * Svelte stores for CRDT-backed collaborative data structures and presence awareness.
 *
 * Provides collabTextStore, collabListStore, collabMapStore, collabCounterStore,
 * cursorsStore, and typingUsersStore — all following the Svelte store contract.
 *
 * Usage:
 *   const text = collabTextStore("doc-1")
 *   $text.text  // reactive text content
 *   text.setText("Hello")
 *
 *   const cursors = cursorsStore("room-1")
 *   $cursors.cursors  // reactive cursor list
 */

import { getReactiveBaseClient } from "./index.js"
import type { Readable } from "./index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CollabTextState {
  /** Current text content */
  text: string
  /** Text length */
  length: number
  /** Whether the document is loading */
  loading: boolean
  /** Connection status */
  connected: boolean
}

export interface CollabTextActions {
  /** Insert text at a position */
  insert: (index: number, text: string) => void
  /** Delete text at a position */
  deleteRange: (index: number, length: number) => void
  /** Replace all text */
  setText: (text: string) => void
}

export type CollabTextStore = Readable<CollabTextState> & CollabTextActions

export interface CollabListState<T> {
  /** Current items */
  items: T[]
  /** Item count */
  length: number
  /** Whether the list is loading */
  loading: boolean
}

export interface CollabListActions<T> {
  /** Add an item */
  push: (item: T) => void
  /** Remove an item */
  remove: (item: T) => void
  /** Check if item exists */
  has: (item: T) => boolean
}

export type CollabListStore<T> = Readable<CollabListState<T>> & CollabListActions<T>

export interface CollabMapState<T> {
  /** Current entries */
  entries: Record<string, T>
  /** All keys */
  keys: string[]
  /** Whether the map is loading */
  loading: boolean
}

export interface CollabMapActions<T> {
  /** Get a value by key */
  get: (key: string) => T | undefined
  /** Set a key-value pair */
  set: (key: string, value: T) => void
  /** Delete a key */
  deleteKey: (key: string) => void
}

export type CollabMapStore<T> = Readable<CollabMapState<T>> & CollabMapActions<T>

export interface CollabCounterState {
  /** Current counter value */
  value: number
  /** Whether the counter is loading */
  loading: boolean
}

export interface CollabCounterActions {
  /** Increment the counter */
  increment: (amount?: number) => void
  /** Decrement the counter */
  decrement: (amount?: number) => void
}

export type CollabCounterStore = Readable<CollabCounterState> & CollabCounterActions

export interface CursorData {
  connectionId: string
  userId: string
  userName: string
  color: string
  x: number
  y: number
  target?: string
}

export interface CursorsState {
  /** Remote cursors in the room */
  cursors: CursorData[]
}

export interface CursorsActions {
  /** Broadcast local cursor position */
  updateCursor: (position: { x: number; y: number; target?: string }) => void
  /** Remove local cursor from room */
  clearCursor: () => void
}

export type CursorsStore = Readable<CursorsState> & CursorsActions

export interface TypingUser {
  connectionId: string
  userId: string
  userName: string
}

export interface TypingUsersState {
  /** Users currently typing in the room */
  typingUsers: TypingUser[]
}

export interface TypingUsersActions {
  /** Toggle local typing state */
  setTyping: (isTyping: boolean) => void
}

export type TypingUsersStore = Readable<TypingUsersState> & TypingUsersActions

// ─── collabTextStore ─────────────────────────────────────────────────────────

/**
 * Create a Svelte store for CRDT-backed collaborative text editing.
 *
 * Usage:
 *   const doc = collabTextStore("doc-1")
 *   $doc.text       // reactive text
 *   doc.setText("Hello")
 *   doc.insert(5, " world")
 *
 * @param docId - Unique identifier for the collaborative document
 */
export function collabTextStore(docId: string): CollabTextStore {
  let text = ""
  let loading = true
  let connected = false
  let subscribers: Array<(value: CollabTextState) => void> = []

  function currentState(): CollabTextState {
    return { text, length: text.length, loading, connected }
  }

  function notify(): void {
    const state = currentState()
    for (const fn of subscribers) fn(state)
  }

  return {
    subscribe(run: (value: CollabTextState) => void): () => void {
      const client = getReactiveBaseClient()
      subscribers.push(run)
      run(currentState())

      const unsubscribe = client.subscribe(`__collab_text_${docId}`, { docId }, (result, err) => {
        if (!err && typeof result === "string") {
          text = result
        } else if (!err && result && typeof result === "object" && "text" in (result as Record<string, unknown>)) {
          text = (result as { text: string }).text
        }
        loading = false
        connected = true
        notify()
      })

      loading = false
      connected = true
      notify()

      return () => {
        subscribers = subscribers.filter((s) => s !== run)
        unsubscribe()
      }
    },

    insert(index: number, insertText: string): void {
      const client = getReactiveBaseClient()
      text = text.slice(0, index) + insertText + text.slice(index)
      client.mutate("__collab_text_insert", { docId, index, text: insertText })
      notify()
    },

    deleteRange(index: number, length: number): void {
      const client = getReactiveBaseClient()
      text = text.slice(0, index) + text.slice(index + length)
      client.mutate("__collab_text_delete", { docId, index, length })
      notify()
    },

    setText(newText: string): void {
      const client = getReactiveBaseClient()
      text = newText
      client.mutate("__collab_text_set", { docId, text: newText })
      notify()
    },
  }
}

// ─── collabListStore ─────────────────────────────────────────────────────────

/**
 * Create a Svelte store for CRDT-backed collaborative lists.
 *
 * Usage:
 *   const list = collabListStore<string>("shopping-list")
 *   $list.items     // reactive items
 *   list.push("Milk")
 *
 * @param docId - Unique identifier for the collaborative list
 */
export function collabListStore<T = unknown>(docId: string): CollabListStore<T> {
  let items: T[] = []
  let loading = true
  let subscribers: Array<(value: CollabListState<T>) => void> = []

  function currentState(): CollabListState<T> {
    return { items: [...items], length: items.length, loading }
  }

  function notify(): void {
    const state = currentState()
    for (const fn of subscribers) fn(state)
  }

  return {
    subscribe(run: (value: CollabListState<T>) => void): () => void {
      const client = getReactiveBaseClient()
      subscribers.push(run)
      run(currentState())

      const unsubscribe = client.subscribe(`__collab_list_${docId}`, { docId }, (result, err) => {
        if (!err && Array.isArray(result)) {
          items = result as T[]
        }
        loading = false
        notify()
      })

      loading = false
      notify()

      return () => {
        subscribers = subscribers.filter((s) => s !== run)
        unsubscribe()
      }
    },

    push(item: T): void {
      const client = getReactiveBaseClient()
      items = [...items, item]
      client.mutate("__collab_list_push", { docId, item })
      notify()
    },

    remove(item: T): void {
      const client = getReactiveBaseClient()
      items = items.filter((i) => i !== item)
      client.mutate("__collab_list_remove", { docId, item })
      notify()
    },

    has(item: T): boolean {
      return items.includes(item)
    },
  }
}

// ─── collabMapStore ──────────────────────────────────────────────────────────

/**
 * Create a Svelte store for CRDT-backed collaborative maps.
 *
 * Usage:
 *   const settings = collabMapStore<string>("settings")
 *   $settings.entries   // reactive entries
 *   settings.set("theme", "dark")
 *
 * @param docId - Unique identifier for the collaborative map
 */
export function collabMapStore<T = unknown>(docId: string): CollabMapStore<T> {
  let entries: Record<string, T> = {}
  let loading = true
  let subscribers: Array<(value: CollabMapState<T>) => void> = []

  function currentState(): CollabMapState<T> {
    return { entries: { ...entries }, keys: Object.keys(entries), loading }
  }

  function notify(): void {
    const state = currentState()
    for (const fn of subscribers) fn(state)
  }

  return {
    subscribe(run: (value: CollabMapState<T>) => void): () => void {
      const client = getReactiveBaseClient()
      subscribers.push(run)
      run(currentState())

      const unsubscribe = client.subscribe(`__collab_map_${docId}`, { docId }, (result, err) => {
        if (!err && result && typeof result === "object") {
          entries = result as Record<string, T>
        }
        loading = false
        notify()
      })

      loading = false
      notify()

      return () => {
        subscribers = subscribers.filter((s) => s !== run)
        unsubscribe()
      }
    },

    get(key: string): T | undefined {
      return entries[key]
    },

    set(key: string, value: T): void {
      const client = getReactiveBaseClient()
      entries = { ...entries, [key]: value }
      client.mutate("__collab_map_set", { docId, key, value })
      notify()
    },

    deleteKey(key: string): void {
      const client = getReactiveBaseClient()
      const next = { ...entries }
      delete next[key]
      entries = next
      client.mutate("__collab_map_delete", { docId, key })
      notify()
    },
  }
}

// ─── collabCounterStore ──────────────────────────────────────────────────────

/**
 * Create a Svelte store for CRDT-backed collaborative counters.
 *
 * Usage:
 *   const likes = collabCounterStore("likes")
 *   $likes.value     // reactive counter value
 *   likes.increment()
 *
 * @param docId - Unique identifier for the collaborative counter
 */
export function collabCounterStore(docId: string): CollabCounterStore {
  let value = 0
  let loading = true
  let subscribers: Array<(value: CollabCounterState) => void> = []

  function currentState(): CollabCounterState {
    return { value, loading }
  }

  function notify(): void {
    const state = currentState()
    for (const fn of subscribers) fn(state)
  }

  return {
    subscribe(run: (value: CollabCounterState) => void): () => void {
      const client = getReactiveBaseClient()
      subscribers.push(run)
      run(currentState())

      const unsubscribe = client.subscribe(`__collab_counter_${docId}`, { docId }, (result, err) => {
        if (!err && typeof result === "number") {
          value = result
        }
        loading = false
        notify()
      })

      loading = false
      notify()

      return () => {
        subscribers = subscribers.filter((s) => s !== run)
        unsubscribe()
      }
    },

    increment(amount = 1): void {
      const client = getReactiveBaseClient()
      value += amount
      client.mutate("__collab_counter_increment", { docId, amount })
      notify()
    },

    decrement(amount = 1): void {
      const client = getReactiveBaseClient()
      value -= amount
      client.mutate("__collab_counter_decrement", { docId, amount })
      notify()
    },
  }
}

// ─── cursorsStore ────────────────────────────────────────────────────────────

/**
 * Create a Svelte store for real-time cursor awareness in a collaboration room.
 *
 * Usage:
 *   const cursors = cursorsStore("doc-123")
 *   $cursors.cursors      // reactive cursor list
 *   cursors.updateCursor({ x: 100, y: 200 })
 *
 * @param roomId - Unique identifier for the collaboration room
 */
export function cursorsStore(roomId: string): CursorsStore {
  let cursors: CursorData[] = []
  let subscribers: Array<(value: CursorsState) => void> = []

  function currentState(): CursorsState {
    return { cursors: [...cursors] }
  }

  function notify(): void {
    const state = currentState()
    for (const fn of subscribers) fn(state)
  }

  return {
    subscribe(run: (value: CursorsState) => void): () => void {
      const client = getReactiveBaseClient()
      subscribers.push(run)
      run(currentState())

      const unsubscribe = client.subscribe(`__collab:cursors:${roomId}`, { roomId }, (result) => {
        if (Array.isArray(result)) {
          cursors = result as CursorData[]
        }
        notify()
      })

      return () => {
        subscribers = subscribers.filter((s) => s !== run)
        unsubscribe()
      }
    },

    updateCursor(position: { x: number; y: number; target?: string }): void {
      const client = getReactiveBaseClient()
      client.mutate("__collab:updateCursor", { roomId, ...position })
    },

    clearCursor(): void {
      const client = getReactiveBaseClient()
      client.mutate("__collab:clearCursor", { roomId })
    },
  }
}

// ─── typingUsersStore ────────────────────────────────────────────────────────

/**
 * Create a Svelte store for typing indicator awareness in a collaboration room.
 *
 * Usage:
 *   const typing = typingUsersStore("doc-123")
 *   $typing.typingUsers   // reactive list of typing users
 *   typing.setTyping(true)
 *
 * @param roomId - Unique identifier for the collaboration room
 */
export function typingUsersStore(roomId: string): TypingUsersStore {
  let typingUsers: TypingUser[] = []
  let subscribers: Array<(value: TypingUsersState) => void> = []

  function currentState(): TypingUsersState {
    return { typingUsers: [...typingUsers] }
  }

  function notify(): void {
    const state = currentState()
    for (const fn of subscribers) fn(state)
  }

  return {
    subscribe(run: (value: TypingUsersState) => void): () => void {
      const client = getReactiveBaseClient()
      subscribers.push(run)
      run(currentState())

      const unsubscribe = client.subscribe(`__collab:typing:${roomId}`, { roomId }, (result) => {
        if (Array.isArray(result)) {
          typingUsers = result as TypingUser[]
        }
        notify()
      })

      return () => {
        subscribers = subscribers.filter((s) => s !== run)
        unsubscribe()
      }
    },

    setTyping(isTyping: boolean): void {
      const client = getReactiveBaseClient()
      client.mutate("__collab:setTyping", { roomId, isTyping })
    },
  }
}
