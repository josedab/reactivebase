/**
 * Binary protocol encoder/decoder for ReactiveBase WebSocket messages.
 * Uses a compact JSON-based binary format (UTF-8 encoded JSON with
 * message type prefix byte) for reduced bandwidth vs raw JSON.
 *
 * Format: [type_byte][json_payload_bytes]
 * Type bytes: 0x01=subscribe, 0x02=unsubscribe, 0x03=mutate, 0x04=action,
 *             0x05=ping, 0x06=auth, 0x10=data, 0x11=update, 0x12=error,
 *             0x13=mutation_result, 0x14=mutation_error, 0x15=pong, 0x16=auth_result
 */

const MESSAGE_TYPES = {
  // Client → Server
  subscribe: 0x01,
  unsubscribe: 0x02,
  mutate: 0x03,
  action: 0x04,
  ping: 0x05,
  auth: 0x06,
  // Server → Client
  subscription_data: 0x10,
  subscription_update: 0x11,
  subscription_error: 0x12,
  mutation_result: 0x13,
  mutation_error: 0x14,
  action_result: 0x15,
  action_error: 0x16,
  pong: 0x17,
  auth_result: 0x18,
} as const

const TYPE_TO_NAME = new Map<number, string>()
for (const [name, byte] of Object.entries(MESSAGE_TYPES)) {
  TYPE_TO_NAME.set(byte, name)
}

/**
 * Encode a message to binary format.
 */
export function encodeMessage(message: Record<string, unknown>): ArrayBuffer {
  const typeName = message.type as string
  const typeByte = MESSAGE_TYPES[typeName as keyof typeof MESSAGE_TYPES]

  if (typeByte === undefined) {
    throw new Error(`Unknown message type: ${typeName}`)
  }

  // Encode payload without the type field (it's in the prefix byte)
  const payload = { ...message }
  delete payload.type
  const json = JSON.stringify(payload)
  const encoder = new TextEncoder()
  const payloadBytes = encoder.encode(json)

  const buffer = new ArrayBuffer(1 + payloadBytes.length)
  const view = new Uint8Array(buffer)
  view[0] = typeByte
  view.set(payloadBytes, 1)

  return buffer
}

/**
 * Decode a binary message back to a JSON object.
 */
export function decodeMessage(data: ArrayBuffer): Record<string, unknown> {
  const view = new Uint8Array(data)
  if (view.length === 0) throw new Error("Empty message")

  const typeByte = view[0]
  const typeName = TYPE_TO_NAME.get(typeByte)
  if (!typeName) throw new Error(`Unknown message type byte: 0x${typeByte.toString(16)}`)

  if (view.length === 1) return { type: typeName }

  const decoder = new TextDecoder()
  const json = decoder.decode(view.slice(1))
  const payload = JSON.parse(json) as Record<string, unknown>

  return { type: typeName, ...payload }
}

/**
 * Check if a WebSocket message is binary.
 */
export function isBinaryMessage(data: unknown): data is ArrayBuffer {
  return data instanceof ArrayBuffer
}

/**
 * Calculate compression ratio vs JSON.
 */
export function compressionRatio(message: Record<string, unknown>): number {
  const jsonSize = new TextEncoder().encode(JSON.stringify(message)).length
  const binarySize = encodeMessage(message).byteLength
  return 1 - binarySize / jsonSize
}
