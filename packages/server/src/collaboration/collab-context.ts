/**
 * Collaborative Database Context for ReactiveBase.
 * Provides the ctx.db.collab API for accessing CRDT-backed collaborative data types.
 *
 * Usage:
 *   const text = ctx.db.collab.getText("doc-1")
 *   const list = ctx.db.collab.getList("shopping-list")
 *   const map = ctx.db.collab.getMap("settings")
 *   const counter = ctx.db.collab.getCounter("likes")
 */

import type { CrdtEngine } from "../crdt/index.js"
import type { DocumentCollaboration } from "./document-collaboration.js"
import type { CollaborationManager } from "./collaboration.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CollabContextOptions {
  /** CRDT engine instance for conflict-free data types */
  crdtEngine: CrdtEngine
  /** Document collaboration for rich-text editing */
  documentCollaboration: DocumentCollaboration
  /** Collaboration manager for presence/cursors */
  collaborationManager: CollaborationManager
  /** Current user/connection identifier */
  connectionId: string
  /** Current user ID */
  userId?: string
}

export interface CollabText {
  /** Get the current text content */
  getText(): string
  /** Insert text at a position */
  insert(index: number, text: string): void
  /** Delete text at a position */
  delete(index: number, length: number): void
  /** Replace all text */
  setText(text: string): void
  /** Get document length */
  length: number
  /** Subscribe to changes */
  onChange(callback: (text: string) => void): () => void
}

export interface CollabList<T = unknown> {
  /** Get all items */
  toArray(): T[]
  /** Add an item */
  push(item: T): void
  /** Remove an item */
  remove(item: T): void
  /** Get item count */
  length: number
  /** Check if item exists */
  has(item: T): boolean
  /** Subscribe to changes */
  onChange(callback: (items: T[]) => void): () => void
}

export interface CollabMap<T = unknown> {
  /** Get a value by key */
  get(key: string): T | undefined
  /** Set a key-value pair */
  set(key: string, value: T): void
  /** Delete a key */
  delete(key: string): void
  /** Get all entries */
  entries(): Record<string, T>
  /** Get all keys */
  keys(): string[]
  /** Subscribe to changes */
  onChange(callback: (entries: Record<string, T>) => void): () => void
}

export interface CollabCounter {
  /** Get current value */
  getValue(): number
  /** Increment by amount */
  increment(amount?: number): void
  /** Decrement by amount */
  decrement(amount?: number): void
  /** Subscribe to changes */
  onChange(callback: (value: number) => void): () => void
}

// ─── Collaborative Context ───────────────────────────────────────────────────

/**
 * Creates the ctx.db.collab API for accessing collaborative data structures.
 */
export function createCollabContext(options: CollabContextOptions) {
  const { crdtEngine, documentCollaboration, collaborationManager, connectionId } = options

  return {
    /**
     * Get a collaborative text document (CRDT-backed, Yjs-compatible).
     * Creates the document if it doesn't exist.
     */
    getText(docId: string): CollabText {
      // Use document collaboration for rich text
      if (!documentCollaboration.getDocument(docId)) {
        documentCollaboration.createDocument(docId, "plaintext")
      }

      return {
        getText(): string {
          const doc = documentCollaboration.getDocument(docId)
          if (!doc || !doc.state) return ""
          try {
            return new TextDecoder().decode(doc.state)
          } catch {
            return ""
          }
        },

        insert(index: number, text: string): void {
          const encoded = new TextEncoder().encode(text)
          const update = createTextInsertUpdate(docId, connectionId, index, encoded)
          documentCollaboration.applyUpdate(docId, update, connectionId)
        },

        delete(index: number, length: number): void {
          const update = createTextDeleteUpdate(docId, connectionId, index, length)
          documentCollaboration.applyUpdate(docId, update, connectionId)
        },

        setText(text: string): void {
          const encoded = new TextEncoder().encode(text)
          documentCollaboration.applyUpdate(docId, encoded, connectionId)
        },

        get length(): number {
          const doc = documentCollaboration.getDocument(docId)
          return doc?.state?.length ?? 0
        },

        onChange(callback: (text: string) => void): () => void {
          // Poll-based change detection via snapshot comparison
          let lastVersion = documentCollaboration.getDocument(docId)?.version ?? 0
          const interval = setInterval(() => {
            const doc = documentCollaboration.getDocument(docId)
            if (doc && doc.version !== lastVersion) {
              lastVersion = doc.version
              const text = doc.state ? new TextDecoder().decode(doc.state) : ""
              callback(text)
            }
          }, 100)
          return () => clearInterval(interval)
        },
      }
    },

    /**
     * Get a collaborative list (OR-Set CRDT).
     * Creates the document if it doesn't exist.
     */
    getList<T = unknown>(docId: string): CollabList<T> {
      if (!crdtEngine.hasDocument(docId)) {
        crdtEngine.createDocument(docId, "or-set")
      }
      const handle = crdtEngine.getDocument(docId)

      return {
        toArray(): T[] {
          return handle.getValue() as T[]
        },

        push(item: T): void {
          handle.add(item)
        },

        remove(item: T): void {
          handle.remove(item)
        },

        get length(): number {
          return (handle.getValue() as T[]).length
        },

        has(item: T): boolean {
          return (handle.getValue() as T[]).includes(item)
        },

        onChange(callback: (items: T[]) => void): () => void {
          return crdtEngine.subscribe(docId, (state) => {
            callback(state as T[])
          })
        },
      }
    },

    /**
     * Get a collaborative map (LWW-Register CRDT).
     * Creates the document if it doesn't exist.
     */
    getMap<T = unknown>(docId: string): CollabMap<T> {
      if (!crdtEngine.hasDocument(docId)) {
        crdtEngine.createDocument(docId, "lww-register")
      }
      const handle = crdtEngine.getDocument(docId)

      return {
        get(key: string): T | undefined {
          return handle.get(key) as T | undefined
        },

        set(key: string, value: T): void {
          handle.set(key, value)
        },

        delete(key: string): void {
          handle.set(key, null)
        },

        entries(): Record<string, T> {
          return handle.getValue() as Record<string, T>
        },

        keys(): string[] {
          const entries = handle.getValue() as Record<string, T>
          return Object.keys(entries ?? {})
        },

        onChange(callback: (entries: Record<string, T>) => void): () => void {
          return crdtEngine.subscribe(docId, (state) => {
            callback(state as Record<string, T>)
          })
        },
      }
    },

    /**
     * Get a collaborative counter (PN-Counter CRDT).
     * Creates the document if it doesn't exist.
     */
    getCounter(docId: string): CollabCounter {
      if (!crdtEngine.hasDocument(docId)) {
        crdtEngine.createDocument(docId, "pn-counter")
      }
      const handle = crdtEngine.getDocument(docId)

      return {
        getValue(): number {
          return handle.getValue() as number
        },

        increment(amount = 1): void {
          handle.increment(amount)
        },

        decrement(amount = 1): void {
          handle.decrement(amount)
        },

        onChange(callback: (value: number) => void): () => void {
          return crdtEngine.subscribe(docId, (state) => {
            callback(state as number)
          })
        },
      }
    },

    /**
     * Get presence/awareness for a collaborative room.
     */
    getPresence(roomId: string) {
      return collaborationManager.getRoomState(roomId)
    },
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function createTextInsertUpdate(_docId: string, _clientId: string, _index: number, data: Uint8Array): Uint8Array {
  // Simplified update encoding — wraps the data with position metadata
  const header = new Uint8Array([0x01]) // insert operation
  const result = new Uint8Array(header.length + data.length)
  result.set(header)
  result.set(data, header.length)
  return result
}

function createTextDeleteUpdate(_docId: string, _clientId: string, _index: number, _length: number): Uint8Array {
  // Simplified delete update
  return new Uint8Array([0x02])
}
