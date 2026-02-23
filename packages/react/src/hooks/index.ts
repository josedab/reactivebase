export { useQuery, useMutation, useAction } from "./hooks.js"
export type { FunctionReference, OptimisticUpdateConfig, LocalStore } from "./hooks.js"

export { useOptimistic, useCursors, useTypingUsers, useSelections, useDevTools } from "./collaboration-hooks.js"
export type {
  UseOptimisticOptions,
  UseOptimisticReturn,
  CursorData,
  TypingUser,
  SelectionData,
  CollaborationState,
  UseDevToolsReturn,
} from "./collaboration-hooks.js"

// CRDT Collaborative Editing Hooks
export { useCollabText, useCollabList, useCollabMap, useCollabCounter } from "./crdt-hooks.js"
export type {
  UseCollabTextReturn,
  UseCollabListReturn,
  UseCollabMapReturn,
  UseCollabCounterReturn,
  CollabDocumentInfo,
} from "./crdt-hooks.js"
