/**
 * React hooks for ReactiveBase collaboration, optimistic updates, and devtools.
 *
 * These hooks wrap the client-side OptimisticUpdateManager,
 * CollaborationManager (via WebSocket), and DevToolsInstrumentation.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useReactiveBaseClient } from "../provider/provider.js"
import {
  OptimisticUpdateManager,
  type OptimisticCacheAdapter,
  type OptimisticConflictResolver,
} from "@reactivebase/client"
import {
  DevToolsInstrumentation,
  type DevToolsSummary,
  type SubscriptionInfo,
  type MutationInfo,
  type CacheStats,
  type WebSocketStats,
} from "@reactivebase/client"

// ─── useOptimistic ───────────────────────────────────────────────────────────

export interface UseOptimisticOptions {
  /** Auto-rollback timeout in ms (default: 30000) */
  timeoutMs?: number
  /** Max snapshots to retain (default: 50) */
  maxSnapshots?: number
  /** Custom conflict resolver */
  conflictResolver?: OptimisticConflictResolver
}

export interface UseOptimisticReturn<T> {
  /** Current data (may be optimistic) */
  data: T
  /** Apply an optimistic update and return the mutation ID */
  applyOptimistic: (optimisticData: T) => string
  /** Confirm a mutation succeeded */
  confirm: (mutationId: string, serverData?: T) => void
  /** Roll back a specific mutation */
  rollback: (mutationId: string) => void
  /** Roll back all pending mutations */
  rollbackAll: () => void
  /** Whether there are pending optimistic updates */
  isPending: boolean
  /** Number of pending mutations */
  pendingCount: number
}

/**
 * Hook for managing optimistic updates on a piece of state.
 * Automatically snapshots, applies, confirms, and rolls back mutations.
 *
 * Usage:
 *   const { data, applyOptimistic, confirm, rollback, isPending } = useOptimistic(tasks)
 *   const mutationId = applyOptimistic([...tasks, newTask])
 *   try {
 *     await serverMutation()
 *     confirm(mutationId)
 *   } catch {
 *     rollback(mutationId)
 *   }
 *
 * @param serverData - The current server-authoritative data
 * @param options - Options for timeout, max snapshots, and conflict resolution
 * @returns An object with the current data and functions to apply/confirm/rollback optimistic updates
 */
export function useOptimistic<T>(serverData: T, options: UseOptimisticOptions = {}): UseOptimisticReturn<T> {
  const [localData, setLocalData] = useState<T>(serverData)
  const [pendingCount, setPendingCount] = useState(0)
  const mutationCounter = useRef(0)

  const cacheAdapter = useMemo<OptimisticCacheAdapter>(
    () => ({
      get() {
        return { data: localData, version: mutationCounter.current }
      },
      update(_id: string, data: unknown, _version: number) {
        setLocalData(data as T)
      },
    }),
    [],
  ) // intentionally stable — updates via setLocalData

  const manager = useMemo(
    () =>
      new OptimisticUpdateManager(cacheAdapter, {
        timeoutMs: options.timeoutMs ?? 30_000,
        maxSnapshots: options.maxSnapshots ?? 50,
        onRollback: () => setPendingCount((c) => Math.max(0, c - 1)),
        onConfirm: () => setPendingCount((c) => Math.max(0, c - 1)),
        onTimeout: () => setPendingCount((c) => Math.max(0, c - 1)),
      }),
    [],
  )

  // Sync with server data when it changes (and no pending optimistic updates)
  useEffect(() => {
    if (manager.getPendingCount() === 0) {
      setLocalData(serverData)
    }
  }, [serverData])

  // Set conflict resolver if provided
  useEffect(() => {
    if (options.conflictResolver) {
      manager.setConflictResolver(options.conflictResolver)
    }
  }, [options.conflictResolver])

  const applyOptimistic = useCallback(
    (optimisticData: T): string => {
      const mutationId = `opt_${++mutationCounter.current}_${Date.now()}`
      manager.apply({
        mutationId,
        subscriptionId: "local",
        optimisticData,
      })
      setPendingCount((c) => c + 1)
      return mutationId
    },
    [manager],
  )

  const confirm = useCallback(
    (mutationId: string, serverData?: T) => {
      manager.confirm(mutationId, serverData)
    },
    [manager],
  )

  const rollback = useCallback(
    (mutationId: string) => {
      manager.rollback(mutationId)
    },
    [manager],
  )

  const rollbackAll = useCallback(() => {
    manager.rollbackAll()
    setPendingCount(0)
  }, [manager])

  return {
    data: localData,
    applyOptimistic,
    confirm,
    rollback,
    rollbackAll,
    isPending: pendingCount > 0,
    pendingCount,
  }
}

// ─── useCollaboration (Cursors, Typing, Selections) ──────────────────────────

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

export interface SelectionData {
  connectionId: string
  userId: string
  color: string
  field: string
  start: number
  end: number
}

export interface CollaborationState {
  cursors: CursorData[]
  typingUsers: TypingUser[]
  selections: SelectionData[]
  activeUsers: number
}

/**
 * Hook for real-time cursor awareness in a collaboration room.
 * Returns the list of remote cursors and a function to broadcast local cursor.
 *
 * Usage:
 *   const { cursors, updateCursor, clearCursor } = useCursors("doc-123")
 *
 * @param roomId - Unique identifier for the collaboration room
 * @returns Object with remote `cursors` array, `updateCursor` to broadcast position, and `clearCursor` to remove
 */
export function useCursors(roomId: string): {
  cursors: CursorData[]
  updateCursor: (position: { x: number; y: number; target?: string }) => void
  clearCursor: () => void
} {
  const client = useReactiveBaseClient()
  const [cursors, setCursors] = useState<CursorData[]>([])

  useEffect(() => {
    const unsubscribe = client.subscribe(`__collab:cursors:${roomId}`, { roomId }, (result) => {
      if (Array.isArray(result)) {
        setCursors(result as CursorData[])
      }
    })
    return unsubscribe
  }, [client, roomId])

  const updateCursor = useCallback(
    (position: { x: number; y: number; target?: string }) => {
      client.mutate("__collab:updateCursor", { roomId, ...position })
    },
    [client, roomId],
  )

  const clearCursor = useCallback(() => {
    client.mutate("__collab:clearCursor", { roomId })
  }, [client, roomId])

  return { cursors, updateCursor, clearCursor }
}

/**
 * Hook for typing indicator awareness.
 * Tracks which users are currently typing in a room.
 *
 * Usage:
 *   const { typingUsers, setTyping } = useTypingUsers("doc-123")
 *   onKeyDown={() => setTyping(true)}
 *
 * @param roomId - Unique identifier for the collaboration room
 * @returns Object with `typingUsers` array and `setTyping` to toggle typing state
 */
export function useTypingUsers(roomId: string): {
  typingUsers: TypingUser[]
  setTyping: (isTyping: boolean) => void
} {
  const client = useReactiveBaseClient()
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])

  useEffect(() => {
    const unsubscribe = client.subscribe(`__collab:typing:${roomId}`, { roomId }, (result) => {
      if (Array.isArray(result)) {
        setTypingUsers(result as TypingUser[])
      }
    })
    return unsubscribe
  }, [client, roomId])

  const setTyping = useCallback(
    (isTyping: boolean) => {
      client.mutate("__collab:setTyping", { roomId, isTyping })
    },
    [client, roomId],
  )

  return { typingUsers, setTyping }
}

/**
 * Hook for selection awareness.
 * Tracks text/element selections from other users in the room.
 *
 * Usage:
 *   const { selections, updateSelection, clearSelection } = useSelections("doc-123")
 *
 * @param roomId - Unique identifier for the collaboration room
 * @returns Object with `selections` array, `updateSelection` to broadcast, and `clearSelection` to remove
 */
export function useSelections(roomId: string): {
  selections: SelectionData[]
  updateSelection: (selection: { field: string; start: number; end: number }) => void
  clearSelection: () => void
} {
  const client = useReactiveBaseClient()
  const [selections, setSelections] = useState<SelectionData[]>([])

  useEffect(() => {
    const unsubscribe = client.subscribe(`__collab:selections:${roomId}`, { roomId }, (result) => {
      if (Array.isArray(result)) {
        setSelections(result as SelectionData[])
      }
    })
    return unsubscribe
  }, [client, roomId])

  const updateSelection = useCallback(
    (selection: { field: string; start: number; end: number }) => {
      client.mutate("__collab:updateSelection", { roomId, ...selection })
    },
    [client, roomId],
  )

  const clearSelection = useCallback(() => {
    client.mutate("__collab:clearSelection", { roomId })
  }, [client, roomId])

  return { selections, updateSelection, clearSelection }
}

// ─── useDevTools ─────────────────────────────────────────────────────────────

export interface UseDevToolsReturn {
  /** Summary stats */
  summary: DevToolsSummary
  /** Active subscriptions */
  subscriptions: SubscriptionInfo[]
  /** Recent mutations */
  mutations: MutationInfo[]
  /** Cache statistics */
  cacheStats: CacheStats
  /** WebSocket statistics */
  wsStats: WebSocketStats
  /** Whether DevTools is enabled */
  enabled: boolean
  /** Enable/disable DevTools */
  setEnabled: (enabled: boolean) => void
  /** Take a performance snapshot */
  takeSnapshot: () => void
  /** Reset all tracking data */
  reset: () => void
}

/**
 * Hook for accessing ReactiveBase DevTools data.
 * Provides live stats for subscriptions, mutations, cache, and WebSocket.
 *
 * Usage:
 *   const { summary, subscriptions, mutations } = useDevTools()
 *
 * @param refreshIntervalMs - Polling interval in milliseconds (default: 2000)
 * @returns A {@link UseDevToolsReturn} with stats, controls, and snapshot capabilities
 */
export function useDevTools(refreshIntervalMs: number = 2000): UseDevToolsReturn {
  const [enabled, setEnabled] = useState(false)
  const [summary, setSummary] = useState<DevToolsSummary>({
    activeSubscriptions: 0,
    pendingMutations: 0,
    completedMutations: 0,
    failedMutations: 0,
    cacheHitRate: 0,
    cacheEntries: 0,
    wsStatus: "disconnected",
    wsMessageCount: 0,
    eventCount: 0,
  })
  const [subscriptions, setSubscriptions] = useState<SubscriptionInfo[]>([])
  const [mutations, setMutations] = useState<MutationInfo[]>([])
  const [cacheStats, setCacheStats] = useState<CacheStats>({
    entries: 0,
    hitCount: 0,
    missCount: 0,
    hitRate: 0,
    totalSizeEstimate: 0,
    oldestEntry: null,
    newestEntry: null,
  })
  const [wsStats, setWsStats] = useState<WebSocketStats>({
    messagesSent: 0,
    messagesReceived: 0,
    bytesSent: 0,
    bytesReceived: 0,
    connectionUptime: 0,
    reconnectCount: 0,
    lastMessageAt: null,
    status: "disconnected",
  })

  const devtools = useMemo(() => new DevToolsInstrumentation(), [])

  useEffect(() => {
    if (!enabled) return

    const interval = setInterval(() => {
      setSummary(devtools.getSummary())
      setSubscriptions(devtools.getSubscriptions())
      setMutations(devtools.getMutations())
      setCacheStats(devtools.getCacheStats())
      setWsStats(devtools.getWsStats())
    }, refreshIntervalMs)

    return () => clearInterval(interval)
  }, [enabled, devtools, refreshIntervalMs])

  const takeSnapshot = useCallback(() => {
    devtools.takeSnapshot()
  }, [devtools])

  const reset = useCallback(() => {
    devtools.reset()
    setSummary(devtools.getSummary())
  }, [devtools])

  return {
    summary,
    subscriptions,
    mutations,
    cacheStats,
    wsStats,
    enabled,
    setEnabled,
    takeSnapshot,
    reset,
  }
}
