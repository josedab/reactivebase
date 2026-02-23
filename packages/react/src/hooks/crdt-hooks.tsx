/**
 * React hooks for CRDT-backed collaborative editing.
 * Provides useCollabText, useCollabList, useCollabMap, useCollabCounter
 * for real-time collaborative data structures.
 *
 * Usage:
 *   const { text, insert, delete: del } = useCollabText("doc-1")
 *   const { items, push, remove } = useCollabList<string>("shopping-list")
 *   const { entries, set, get } = useCollabMap<string>("settings")
 *   const { value, increment, decrement } = useCollabCounter("likes")
 */

import { useState, useEffect, useCallback } from "react"
import { useReactiveBaseClient } from "../provider/provider.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseCollabTextReturn {
  /** Current text content */
  text: string
  /** Insert text at a position */
  insert: (index: number, text: string) => void
  /** Delete text at a position */
  deleteRange: (index: number, length: number) => void
  /** Replace all text */
  setText: (text: string) => void
  /** Text length */
  length: number
  /** Whether the document is loading */
  loading: boolean
  /** Connection status */
  connected: boolean
}

export interface UseCollabListReturn<T> {
  /** Current items */
  items: T[]
  /** Add an item */
  push: (item: T) => void
  /** Remove an item */
  remove: (item: T) => void
  /** Check if item exists */
  has: (item: T) => boolean
  /** Item count */
  length: number
  /** Whether the list is loading */
  loading: boolean
}

export interface UseCollabMapReturn<T> {
  /** Current entries */
  entries: Record<string, T>
  /** Get a value by key */
  get: (key: string) => T | undefined
  /** Set a key-value pair */
  set: (key: string, value: T) => void
  /** Delete a key */
  deleteKey: (key: string) => void
  /** All keys */
  keys: string[]
  /** Whether the map is loading */
  loading: boolean
}

export interface UseCollabCounterReturn {
  /** Current counter value */
  value: number
  /** Increment the counter */
  increment: (amount?: number) => void
  /** Decrement the counter */
  decrement: (amount?: number) => void
  /** Whether the counter is loading */
  loading: boolean
}

export interface CollabDocumentInfo {
  docId: string
  type: "text" | "list" | "map" | "counter"
  connectedUsers: number
  lastModified: number
}

// ─── useCollabText ───────────────────────────────────────────────────────────

export function useCollabText(docId: string): UseCollabTextReturn {
  const client = useReactiveBaseClient()
  const [text, setTextState] = useState("")
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    setLoading(true)

    const unsubscribe = client.subscribe(`__collab_text_${docId}`, { docId }, (result, err) => {
      if (!err && typeof result === "string") {
        setTextState(result)
      } else if (!err && result && typeof result === "object" && "text" in (result as Record<string, unknown>)) {
        setTextState((result as { text: string }).text)
      }
      setLoading(false)
      setConnected(true)
    })

    setLoading(false)
    setConnected(true)

    return unsubscribe
  }, [client, docId])

  const insert = useCallback(
    (index: number, insertText: string) => {
      setTextState((prev) => prev.slice(0, index) + insertText + prev.slice(index))
      client.mutate("__collab_text_insert", { docId, index, text: insertText })
    },
    [client, docId],
  )

  const deleteRange = useCallback(
    (index: number, length: number) => {
      setTextState((prev) => prev.slice(0, index) + prev.slice(index + length))
      client.mutate("__collab_text_delete", { docId, index, length })
    },
    [client, docId],
  )

  const setText = useCallback(
    (newText: string) => {
      setTextState(newText)
      client.mutate("__collab_text_set", { docId, text: newText })
    },
    [client, docId],
  )

  return {
    text,
    insert,
    deleteRange,
    setText,
    length: text.length,
    loading,
    connected,
  }
}

// ─── useCollabList ───────────────────────────────────────────────────────────

export function useCollabList<T = unknown>(docId: string): UseCollabListReturn<T> {
  const client = useReactiveBaseClient()
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = client.subscribe(`__collab_list_${docId}`, { docId }, (result, err) => {
      if (!err && Array.isArray(result)) {
        setItems(result as T[])
      }
      setLoading(false)
    })

    setLoading(false)

    return unsubscribe
  }, [client, docId])

  const push = useCallback(
    (item: T) => {
      setItems((prev) => [...prev, item])
      client.mutate("__collab_list_push", { docId, item })
    },
    [client, docId],
  )

  const remove = useCallback(
    (item: T) => {
      setItems((prev) => prev.filter((i) => i !== item))
      client.mutate("__collab_list_remove", { docId, item })
    },
    [client, docId],
  )

  const has = useCallback((item: T) => items.includes(item), [items])

  return {
    items,
    push,
    remove,
    has,
    length: items.length,
    loading,
  }
}

// ─── useCollabMap ────────────────────────────────────────────────────────────

export function useCollabMap<T = unknown>(docId: string): UseCollabMapReturn<T> {
  const client = useReactiveBaseClient()
  const [entries, setEntries] = useState<Record<string, T>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = client.subscribe(`__collab_map_${docId}`, { docId }, (result, err) => {
      if (!err && result && typeof result === "object") {
        setEntries(result as Record<string, T>)
      }
      setLoading(false)
    })

    setLoading(false)

    return unsubscribe
  }, [client, docId])

  const get = useCallback((key: string) => entries[key], [entries])

  const set = useCallback(
    (key: string, value: T) => {
      setEntries((prev) => ({ ...prev, [key]: value }))
      client.mutate("__collab_map_set", { docId, key, value })
    },
    [client, docId],
  )

  const deleteKey = useCallback(
    (key: string) => {
      setEntries((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      client.mutate("__collab_map_delete", { docId, key })
    },
    [client, docId],
  )

  return {
    entries,
    get,
    set,
    deleteKey,
    keys: Object.keys(entries),
    loading,
  }
}

// ─── useCollabCounter ────────────────────────────────────────────────────────

export function useCollabCounter(docId: string): UseCollabCounterReturn {
  const client = useReactiveBaseClient()
  const [value, setValue] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = client.subscribe(`__collab_counter_${docId}`, { docId }, (result, err) => {
      if (!err && typeof result === "number") {
        setValue(result)
      }
      setLoading(false)
    })

    setLoading(false)

    return unsubscribe
  }, [client, docId])

  const increment = useCallback(
    (amount = 1) => {
      setValue((prev) => prev + amount)
      client.mutate("__collab_counter_increment", { docId, amount })
    },
    [client, docId],
  )

  const decrement = useCallback(
    (amount = 1) => {
      setValue((prev) => prev - amount)
      client.mutate("__collab_counter_decrement", { docId, amount })
    },
    [client, docId],
  )

  return { value, increment, decrement, loading }
}
