/** @module @reactivebase/react - React hooks for reactive data */

/** React context provider and client access hook */
export { ReactiveBaseProvider, useReactiveBaseClient } from "./provider/index.js"
export type { ReactiveBaseProviderProps } from "./provider/index.js"

/** Core hooks: useQuery (live data), useMutation (transactional writes), useAction (background jobs) */
export { useQuery, useMutation, useAction, useAggregateQuery } from "./hooks/index.js"
export type {
  FunctionReference,
  OptimisticUpdateConfig,
  LocalStore,
  AggregateQueryOptions,
  AggregateQueryResult,
  UseQueryOptions,
} from "./hooks/index.js"

/** Collaboration hooks: optimistic updates, cursors, typing indicators, selections */
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

/** CRDT collaborative editing hooks for real-time shared data structures */
export { useCollabText, useCollabList, useCollabMap, useCollabCounter } from "./hooks/index.js"
export type {
  UseCollabTextReturn,
  UseCollabListReturn,
  UseCollabMapReturn,
  UseCollabCounterReturn,
  CollabDocumentInfo,
} from "./hooks/index.js"

/** Local-first query hooks for offline SQLite-backed data access */
export { useLocalQuery, useLocalMutation } from "./hooks/index.js"
export type { LocalQueryOptions, UseLocalQueryReturn, LocalQueryFilter, UseLocalMutationReturn } from "./hooks/index.js"

/** File hooks for reactive file state tracking */
export { useFile } from "./hooks/index.js"
export type { FileState, UseFileOptions, UseFileReturn } from "./hooks/index.js"

/** Pre-built reactive UI components */
export { ReactiveTable, ReactiveForm, PresenceAvatars } from "./components.js"
export type {
  ReactiveTableColumn,
  ReactiveTableProps,
  ReactiveFormField,
  ReactiveFormProps,
  PresenceUser,
  PresenceAvatarsProps,
} from "./components.js"

/** Embeddable reactive components with headless variants */
export {
  ReactiveComponentProvider,
  useReactiveQuery,
  ReactiveTable as EmbeddableReactiveTable,
  useReactiveTable,
  ReactiveForm as EmbeddableReactiveForm,
  useReactiveForm,
  ReactiveChart,
  useReactiveChart,
} from "./reactive-components.js"
export type {
  ReactiveComponentTheme,
  ReactiveComponentProviderProps,
  ReactiveQueryOptions,
  ReactiveQueryResult,
  ReactiveTableColumn as EmbeddableReactiveTableColumn,
  ReactiveTablePagination,
  ReactiveTableProps as EmbeddableReactiveTableProps,
  HeadlessTableState,
  ReactiveFormField as EmbeddableReactiveFormField,
  ReactiveFormSchema,
  ReactiveFormProps as EmbeddableReactiveFormProps,
  HeadlessFormState,
  ReactiveChartProps,
  ChartType,
  ChartDataPoint,
  HeadlessChartState,
} from "./reactive-components.js"
