/**
 * WebSocket protocol message types.
 * Defines the wire protocol between client and server.
 */

// --- Client → Server Messages ---

export interface SubscribeMessage {
  type: "subscribe"
  subscriptionId: string
  queryName: string
  args: unknown
}

export interface UnsubscribeMessage {
  type: "unsubscribe"
  subscriptionId: string
}

export interface MutateMessage {
  type: "mutate"
  requestId: string
  mutationName: string
  args: unknown
}

export interface ActionMessage {
  type: "action"
  requestId: string
  actionName: string
  args: unknown
}

export interface PingMessage {
  type: "ping"
}

export interface AuthMessage {
  type: "auth"
  token: string
}

export type ClientMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | MutateMessage
  | ActionMessage
  | PingMessage
  | AuthMessage

// --- Server → Client Messages ---

export interface SubscriptionDataMessage {
  type: "subscription_data"
  subscriptionId: string
  data: unknown
  version: number
}

export interface SubscriptionUpdateMessage {
  type: "subscription_update"
  subscriptionId: string
  data: unknown
  version: number
  diff?: unknown
}

export interface SubscriptionErrorMessage {
  type: "subscription_error"
  subscriptionId: string
  error: ErrorPayload
}

export interface MutationResultMessage {
  type: "mutation_result"
  requestId: string
  data: unknown
}

export interface MutationErrorMessage {
  type: "mutation_error"
  requestId: string
  error: ErrorPayload
}

export interface ActionResultMessage {
  type: "action_result"
  requestId: string
  data: unknown
}

export interface ActionErrorMessage {
  type: "action_error"
  requestId: string
  error: ErrorPayload
}

export interface PongMessage {
  type: "pong"
}

export interface AuthResultMessage {
  type: "auth_result"
  success: boolean
  error?: string
}

export interface ErrorPayload {
  code: string
  message: string
  details?: unknown
}

export type ServerMessage =
  | SubscriptionDataMessage
  | SubscriptionUpdateMessage
  | SubscriptionErrorMessage
  | MutationResultMessage
  | MutationErrorMessage
  | ActionResultMessage
  | ActionErrorMessage
  | PongMessage
  | AuthResultMessage

/**
 * Parse a client message from raw JSON.
 */
export function parseClientMessage(raw: string): ClientMessage {
  const msg = JSON.parse(raw)

  if (!msg || typeof msg !== "object" || !msg.type) {
    throw new Error("Invalid message: missing type field")
  }

  return msg as ClientMessage
}

/**
 * Serialize a server message to JSON.
 */
export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg)
}
