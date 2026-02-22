export { CdcListener, ChangeEventBuffer, deduplicateEvents } from "./cdc.js"
export type { CdcOptions, CdcHandler, PgListenClient } from "./cdc.js"

// Reactive CDC Adapter (Logical Replication → ReactivityEngine)
export { ReactiveCdcAdapter } from "./reactive-cdc.js"
export type { ReactiveCdcOptions, WalChangeEvent, CdcAdapterStats, ProcessChangesCallback } from "./reactive-cdc.js"
