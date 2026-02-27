# ReactiveBase VS Code Extension

Real-time type generation, schema validation, and inline diagnostics for ReactiveBase projects.

## Features

- **🔄 Watch Mode** — Auto-regenerates typed API modules when you save function files
- **📊 Status Bar** — Shows function count and generation status at a glance
- **🔍 Diagnostics** — Inline errors for schema issues (duplicate tables, invalid validators)
- **⚡ Incremental** — Only re-scans files that changed (MD5 hash tracking)
- **🎯 Commands** — Manual generate, validate schema, start/stop watch

## Commands

| Command                          | Description                                |
| -------------------------------- | ------------------------------------------ |
| `ReactiveBase: Generate Types`   | One-shot type generation                   |
| `ReactiveBase: Start Watch Mode` | Watch for file changes and auto-regenerate |
| `ReactiveBase: Stop Watch Mode`  | Stop watching                              |
| `ReactiveBase: Show Status`      | Show extension status in output panel      |
| `ReactiveBase: Validate Schema`  | Validate `schema.ts` for errors            |

## Settings

| Setting                        | Default        | Description                          |
| ------------------------------ | -------------- | ------------------------------------ |
| `reactivebase.functionsDir`    | `./convex`     | Directory with function files        |
| `reactivebase.outputDir`       | `./_generated` | Output directory for generated types |
| `reactivebase.autoGenerate`    | `true`         | Auto-start watch mode on activation  |
| `reactivebase.watchDebounceMs` | `300`          | Debounce delay for regeneration      |
| `reactivebase.showDiagnostics` | `true`         | Show inline diagnostics              |

## Development

```bash
cd packages/vscode-extension
npm install
npm run build

# Test in VS Code
# Press F5 to launch Extension Development Host
```

## Publishing

```bash
npm run package   # Creates .vsix file
npm run publish   # Publishes to VS Code Marketplace
```

## Documentation

Full documentation is available at [reactivebase.dev](https://reactivebase.dev).
