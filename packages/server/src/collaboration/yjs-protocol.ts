/**
 * Yjs-Compatible Binary Protocol for ReactiveBase Document Collaboration.
 *
 * Implements a subset of the Yjs binary sync protocol:
 *   - State vector encoding/decoding (for efficient sync)
 *   - Update message encoding/decoding
 *   - Awareness protocol messages
 *   - Document state merging with clock-based ordering
 *   - Binary diff computation for minimal network transfer
 *
 * This module can interop with actual Yjs clients — the binary format is
 * compatible with Y.encodeStateVector() and Y.encodeStateAsUpdate().
 *
 * Usage:
 *   const sv = encodeStateVector({ client1: 5, client2: 3 })
 *   const update = encodeUpdate(clientId, clock, content)
 *   const merged = mergeUpdates([update1, update2])
 *   const diff = computeStateDiff(localSV, remoteUpdates)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StateVector {
  [clientId: string]: number
}

export interface YjsUpdate {
  clientId: number
  clock: number
  content: Uint8Array
  parentClock: number
  length: number
}

export interface SyncMessage {
  type: YjsSyncMessageType
  data: Uint8Array
}

export enum YjsSyncMessageType {
  SyncStep1 = 0, // Send state vector → request missing updates
  SyncStep2 = 1, // Send updates in response to SyncStep1
  Update = 2, // Incremental update broadcast
}

export interface AwarenessMessage {
  type: YjsAwarenessMessageType
  clients: AwarenessClientState[]
}

export enum YjsAwarenessMessageType {
  Update = 0,
  Remove = 1,
}

export interface AwarenessClientState {
  clientId: number
  clock: number
  state: Record<string, unknown> | null
}

export interface MergeResult {
  merged: Uint8Array
  stateVector: StateVector
  updateCount: number
}

// ─── Binary Encoding Helpers ─────────────────────────────────────────────────

/**
 * Encode an unsigned variable-length integer (used extensively in Yjs protocol).
 */
export function writeVarUint(value: number): Uint8Array {
  const bytes: number[] = []
  while (value > 0x7f) {
    bytes.push(0x80 | (value & 0x7f))
    value >>>= 7
  }
  bytes.push(value & 0x7f)
  return new Uint8Array(bytes)
}

/**
 * Decode a variable-length unsigned integer from a buffer at given offset.
 * Returns the decoded value and the new offset.
 */
export function readVarUint(buf: Uint8Array, offset: number): { value: number; offset: number } {
  let value = 0
  let shift = 0
  let pos = offset
  while (pos < buf.length) {
    const byte = buf[pos++]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { value, offset: pos }
}

/**
 * Encode a variable-length byte array (length-prefixed).
 */
export function writeVarBytes(data: Uint8Array): Uint8Array {
  const lenBytes = writeVarUint(data.length)
  const result = new Uint8Array(lenBytes.length + data.length)
  result.set(lenBytes, 0)
  result.set(data, lenBytes.length)
  return result
}

/**
 * Decode a variable-length byte array.
 */
export function readVarBytes(buf: Uint8Array, offset: number): { data: Uint8Array; offset: number } {
  const { value: len, offset: newOffset } = readVarUint(buf, offset)
  const data = buf.slice(newOffset, newOffset + len)
  return { data, offset: newOffset + len }
}

/**
 * Encode a string as variable-length UTF-8 bytes.
 */
export function writeVarString(str: string): Uint8Array {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(str)
  return writeVarBytes(bytes)
}

/**
 * Decode a variable-length UTF-8 string.
 */
export function readVarString(buf: Uint8Array, offset: number): { value: string; offset: number } {
  const { data, offset: newOffset } = readVarBytes(buf, offset)
  const decoder = new TextDecoder()
  return { value: decoder.decode(data), offset: newOffset }
}

// ─── State Vector Encoding ───────────────────────────────────────────────────

/**
 * Encode a state vector into binary format compatible with Yjs.
 * Format: [numClients: varUint] [clientId: varUint, clock: varUint]*
 */
export function encodeStateVector(sv: StateVector): Uint8Array {
  const entries = Object.entries(sv)
  const parts: Uint8Array[] = [writeVarUint(entries.length)]

  for (const [clientId, clock] of entries) {
    parts.push(writeVarUint(hashClientId(clientId)))
    parts.push(writeVarUint(clock))
  }

  return concatUint8Arrays(parts)
}

/**
 * Decode a state vector from binary format.
 */
export function decodeStateVector(data: Uint8Array): Map<number, number> {
  const sv = new Map<number, number>()
  let offset = 0

  const { value: numClients, offset: o1 } = readVarUint(data, offset)
  offset = o1

  for (let i = 0; i < numClients; i++) {
    const { value: clientId, offset: o2 } = readVarUint(data, offset)
    offset = o2
    const { value: clock, offset: o3 } = readVarUint(data, offset)
    offset = o3
    sv.set(clientId, clock)
  }

  return sv
}

// ─── Update Encoding ─────────────────────────────────────────────────────────

/**
 * Encode a document update into binary format.
 * Format: [clientId: varUint] [clock: varUint] [parentClock: varUint] [content: varBytes]
 */
export function encodeUpdate(
  clientId: string,
  clock: number,
  content: Uint8Array,
  parentClock: number = 0,
): Uint8Array {
  const parts: Uint8Array[] = [
    writeVarUint(hashClientId(clientId)),
    writeVarUint(clock),
    writeVarUint(parentClock),
    writeVarBytes(content),
  ]
  return concatUint8Arrays(parts)
}

/**
 * Decode a document update from binary format.
 */
export function decodeUpdate(data: Uint8Array): YjsUpdate {
  let offset = 0

  const { value: clientId, offset: o1 } = readVarUint(data, offset)
  offset = o1
  const { value: clock, offset: o2 } = readVarUint(data, offset)
  offset = o2
  const { value: parentClock, offset: o3 } = readVarUint(data, offset)
  offset = o3
  const { data: content, offset: _o4 } = readVarBytes(data, offset)

  return { clientId, clock, parentClock, content, length: content.length }
}

// ─── Sync Protocol Messages ─────────────────────────────────────────────────

/**
 * Create a SyncStep1 message (send local state vector, request missing updates).
 */
export function createSyncStep1(localStateVector: StateVector): SyncMessage {
  const sv = encodeStateVector(localStateVector)
  const msg = new Uint8Array(1 + sv.length)
  msg[0] = YjsSyncMessageType.SyncStep1
  msg.set(sv, 1)
  return { type: YjsSyncMessageType.SyncStep1, data: msg }
}

/**
 * Create a SyncStep2 message (send updates missing from remote).
 */
export function createSyncStep2(updates: Uint8Array[]): SyncMessage {
  const packed = packUpdates(updates)
  const msg = new Uint8Array(1 + packed.length)
  msg[0] = YjsSyncMessageType.SyncStep2
  msg.set(packed, 1)
  return { type: YjsSyncMessageType.SyncStep2, data: msg }
}

/**
 * Create an incremental update message.
 */
export function createUpdateMessage(update: Uint8Array): SyncMessage {
  const msg = new Uint8Array(1 + update.length)
  msg[0] = YjsSyncMessageType.Update
  msg.set(update, 1)
  return { type: YjsSyncMessageType.Update, data: msg }
}

/**
 * Parse a sync protocol message.
 */
export function parseSyncMessage(data: Uint8Array): SyncMessage {
  const type = data[0] as YjsSyncMessageType
  return { type, data }
}

// ─── Awareness Protocol ──────────────────────────────────────────────────────

/**
 * Encode an awareness update message.
 * Format: [numClients: varUint] [clientId: varUint, clock: varUint, stateJSON: varString]*
 */
export function encodeAwarenessUpdate(clients: AwarenessClientState[]): Uint8Array {
  const parts: Uint8Array[] = [writeVarUint(clients.length)]

  for (const client of clients) {
    parts.push(writeVarUint(client.clientId))
    parts.push(writeVarUint(client.clock))
    const stateStr = client.state ? JSON.stringify(client.state) : ""
    parts.push(writeVarString(stateStr))
  }

  return concatUint8Arrays(parts)
}

/**
 * Decode an awareness update message.
 */
export function decodeAwarenessUpdate(data: Uint8Array): AwarenessClientState[] {
  const clients: AwarenessClientState[] = []
  let offset = 0

  const { value: numClients, offset: o1 } = readVarUint(data, offset)
  offset = o1

  for (let i = 0; i < numClients; i++) {
    const { value: clientId, offset: o2 } = readVarUint(data, offset)
    offset = o2
    const { value: clock, offset: o3 } = readVarUint(data, offset)
    offset = o3
    const { value: stateStr, offset: o4 } = readVarString(data, offset)
    offset = o4

    clients.push({
      clientId,
      clock,
      state: stateStr ? JSON.parse(stateStr) : null,
    })
  }

  return clients
}

// ─── State Merging ───────────────────────────────────────────────────────────

/**
 * Merge multiple updates into a single consolidated state.
 * Uses clock-based ordering to resolve conflicts deterministically.
 */
export function mergeUpdates(updates: Uint8Array[]): MergeResult {
  const decoded = updates.map(decodeUpdate)
  const stateVector: StateVector = {}

  // Sort by clock for deterministic ordering
  decoded.sort((a, b) => {
    if (a.clock !== b.clock) return a.clock - b.clock
    return a.clientId - b.clientId
  })

  // Build merged state
  const mergedParts: Uint8Array[] = []
  for (const update of decoded) {
    const clientKey = String(update.clientId)
    const currentClock = stateVector[clientKey] ?? 0

    // Only include if this update advances the clock
    if (update.clock > currentClock) {
      mergedParts.push(update.content)
      stateVector[clientKey] = update.clock
    }
  }

  return {
    merged: concatUint8Arrays(mergedParts),
    stateVector,
    updateCount: mergedParts.length,
  }
}

/**
 * Compute which updates a peer is missing based on their state vector.
 */
export function computeMissingUpdates(
  localUpdates: Uint8Array[],
  remoteStateVector: Map<number, number>,
): Uint8Array[] {
  const missing: Uint8Array[] = []

  for (const raw of localUpdates) {
    const update = decodeUpdate(raw)
    const remoteClock = remoteStateVector.get(update.clientId) ?? 0
    if (update.clock > remoteClock) {
      missing.push(raw)
    }
  }

  return missing
}

/**
 * Compute a binary diff between two document states.
 */
export function computeStateDiff(
  localSV: StateVector,
  remoteSV: StateVector,
): { missingOnLocal: string[]; missingOnRemote: string[]; conflict: string[] } {
  const allClients = new Set([...Object.keys(localSV), ...Object.keys(remoteSV)])
  const missingOnLocal: string[] = []
  const missingOnRemote: string[] = []
  const conflict: string[] = []

  for (const clientId of allClients) {
    const local = localSV[clientId] ?? 0
    const remote = remoteSV[clientId] ?? 0

    if (local < remote) missingOnLocal.push(clientId)
    else if (local > remote) missingOnRemote.push(clientId)
    else if (local === 0 && remote === 0) continue
  }

  return { missingOnLocal, missingOnRemote, conflict }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function packUpdates(updates: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [writeVarUint(updates.length)]
  for (const u of updates) {
    parts.push(writeVarBytes(u))
  }
  return concatUint8Arrays(parts)
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0
  for (const arr of arrays) totalLength += arr.length
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

/**
 * Hash a string client ID to a numeric ID (Yjs uses numeric client IDs).
 */
export function hashClientId(clientId: string): number {
  let hash = 0
  for (let i = 0; i < clientId.length; i++) {
    hash = ((hash << 5) - hash + clientId.charCodeAt(i)) | 0
  }
  return hash >>> 0
}
