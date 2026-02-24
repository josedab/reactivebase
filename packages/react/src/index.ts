export { ReactiveBaseProvider, useReactiveBaseClient } from "./provider/index.js"
export type { ReactiveBaseProviderProps } from "./provider/index.js"

export { useQuery, useMutation, useAction, useAggregateQuery } from "./hooks/index.js"
export type {
  FunctionReference,
  OptimisticUpdateConfig,
  LocalStore,
  AggregateQueryOptions,
  AggregateQueryResult,
  UseQueryOptions,
} from "./hooks/index.js"

export { useOptimistic, useCursors, useTypingUsers, useSelections, useDevTools } from "./hooks/index.js"
export type {
  UseOptimisticOptions,
  UseOptimisticReturn,
  CursorData,
  TypingUser,
  SelectionData,
  CollaborationState,
  UseDevToolsReturn,
} from "./hooks/index.js"

// CRDT Collaborative Editing Hooks
export { useCollabText, useCollabList, useCollabMap, useCollabCounter } from "./hooks/index.js"
export type {
  UseCollabTextReturn,
  UseCollabListReturn,
  UseCollabMapReturn,
  UseCollabCounterReturn,
  CollabDocumentInfo,
} from "./hooks/index.js"
