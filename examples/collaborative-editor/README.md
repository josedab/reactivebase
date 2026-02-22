# Collaborative Editor — ReactiveBase Example

A real-time collaborative document editor using Yjs + ReactiveBase.

## Features

- 📝 **Rich-text editing** with shared cursors and selections
- 👥 **Live presence** — see who's editing and their cursor position
- ↩️ **Undo/redo** per user with collaborative conflict resolution
- 📸 **Version snapshots** — save and restore document versions
- 🔄 **Offline support** — edit offline, sync when reconnected

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

## Architecture

Documents are stored as Yjs-compatible binary state in Postgres. The ReactiveBase
Yjs protocol module handles:
- Binary state vector encoding/decoding
- Incremental update merging with clock-based ordering
- Awareness protocol for cursor/selection sync
- Conflict-free merge via CRDT operations
