/**
 * ReactiveBase Live Playground Engine.
 *
 * This module re-exports from focused sub-modules:
 *   - playground-types.ts    — Shared types, constants, SQL persistence helpers
 *   - playground-templates.ts — Built-in templates and tutorials
 *   - playground-engine.ts   — PlaygroundEngine class (sessions, execution, tutorials, sharing)
 *   - playground-html.ts     — Self-contained HTML generation for embedding
 */

// ─── Types, constants, SQL persistence ──────────────────────────────────────
export {
  PlaygroundError,
  DEFAULT_PLAYGROUND_OPTIONS,
  generatePlaygroundTableSQL,
  buildSaveSessionSQL,
  buildLoadSessionSQL,
  buildListSessionsSQL,
  buildDeleteSessionSQL,
} from "./playground-types.js"
export type {
  PlaygroundSession,
  ExecutionResult,
  TutorialDefinition,
  TutorialStep,
  PlaygroundOptions,
  PlaygroundContext,
  LogEntry,
  PlaygroundTemplate,
  PlaygroundHTMLOptions,
} from "./playground-types.js"

// ─── Built-in templates and tutorials ───────────────────────────────────────
export { PLAYGROUND_TEMPLATES, BUILTIN_TUTORIALS } from "./playground-templates.js"

// ─── Engine ─────────────────────────────────────────────────────────────────
export { PlaygroundEngine } from "./playground-engine.js"

// ─── HTML generator ─────────────────────────────────────────────────────────
export { generatePlaygroundHTML } from "./playground-html.js"
