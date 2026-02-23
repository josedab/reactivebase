export { CollaborationManager } from "./collaboration.js"

export type {
  CursorPosition,
  SelectionRange,
  UserAwareness,
  RoomAwarenessState,
  CollaborationOptions,
  AwarenessListener,
} from "./collaboration.js"

// Collaborative Context (ctx.db.collab)
export { createCollabContext } from "./collab-context.js"
export type { CollabContextOptions, CollabText, CollabList, CollabMap, CollabCounter } from "./collab-context.js"

// Document Collaboration
export {
  DocumentCollaboration,
  generateCollabDocTableSQL,
  buildInsertDocumentSQL,
  buildInsertUpdateSQL,
} from "./document-collaboration.js"
export type {
  CollaborativeDocument,
  DocumentType,
  DocumentUpdate,
  DocumentSnapshot,
  UndoEntry,
  DocumentAwareness,
  DocumentCollaborationOptions,
  DocumentStats,
} from "./document-collaboration.js"

// Yjs Binary Protocol
export {
  writeVarUint,
  readVarUint,
  writeVarBytes,
  readVarBytes,
  writeVarString,
  readVarString,
  encodeStateVector,
  decodeStateVector,
  encodeUpdate,
  decodeUpdate,
  createSyncStep1,
  createSyncStep2,
  createUpdateMessage,
  parseSyncMessage,
  encodeAwarenessUpdate,
  decodeAwarenessUpdate,
  mergeUpdates,
  computeMissingUpdates,
  computeStateDiff,
  hashClientId,
  YjsSyncMessageType,
  YjsAwarenessMessageType,
} from "./yjs-protocol.js"
export type {
  StateVector,
  YjsUpdate,
  SyncMessage,
  AwarenessMessage,
  AwarenessClientState,
  MergeResult,
} from "./yjs-protocol.js"
