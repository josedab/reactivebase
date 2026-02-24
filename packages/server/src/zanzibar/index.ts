export {
  ZanzibarEngine,
  ZanzibarError,
  buildCreateZanzibarTablesSQL,
  buildWriteTupleSQL,
  buildDeleteTupleSQL,
  buildReadTuplesSQL,
  buildListObjectsSQL,
  buildReverseExpandSQL,
  buildLogChangeSQL,
} from "./zanzibar.js"

export type {
  RelationTuple,
  NamespaceConfig,
  RelationRule,
  RelationRef,
  CheckRequest,
  CheckResult,
  ResolutionStep,
  ExpandResult,
  UsersetTree,
  ListObjectsRequest,
  ZanzibarOptions,
  ZanzibarStats,
} from "./zanzibar.js"
