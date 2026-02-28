export { useQuery, useMutation, useAction, useAggregateQuery } from "./hooks.js"
export type {
  FunctionReference,
  OptimisticUpdateConfig,
  LocalStore,
  AggregateQueryOptions,
  AggregateQueryResult,
  UseQueryOptions,
} from "./hooks.js"

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

// Full-Text Search Hooks
export { useSearch, SearchInput } from "./search-hooks.js"
export type { UseSearchOptions, UseSearchReturn, SearchInputProps } from "./search-hooks.js"

// Local-First Query Hooks
export { useLocalQuery, useLocalMutation } from "./local-query-hooks.js"
export type {
  LocalQueryOptions,
  UseLocalQueryReturn,
  LocalQueryFilter,
  UseLocalMutationReturn,
} from "./local-query-hooks.js"
