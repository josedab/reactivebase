# Scripts

Utility scripts for publishing, verification, and content creation.

| Script               | Purpose                                                                                                                              | When to Run                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `publish.sh`         | Publishes all 14 packages to npm in dependency order. Runs build and tests first. Defaults to dry-run mode.                          | Release time. Use `--real` flag for actual publish.     |
| `verify-publish.sh`  | Post-publish smoke test: checks npm registry, scaffolds a test project, installs deps, and builds.                                   | After `publish.sh --real` to confirm packages are live. |
| `verify-demo.sh`     | Checks that the `examples/collaborative-board` demo has all required files and Docker builds.                                        | Before deploying the demo to Fly.io.                    |
| `update-stats.sh`    | Counts packages and test totals across the monorepo. Prints values to update in docs.                                                | Before releases to keep README/docs stats current.      |
| `video-recording.sh` | Interactive terminal script for recording the quickstart video. Displays code snippets section by section with pauses for narration. | When re-recording the quickstart screencast.            |

## Usage

```bash
# Dry-run publish (default)
./scripts/publish.sh

# Actual publish to npm
./scripts/publish.sh --real

# Verify packages after publish
./scripts/verify-publish.sh

# Check demo deployment readiness
./scripts/verify-demo.sh

# Update package/test counts
./scripts/update-stats.sh

# Record quickstart video
./scripts/video-recording.sh
```

## Prerequisites

- **publish.sh**: Must be logged into npm with `@reactivebase` scope access (`npm login`)
- **verify-publish.sh**: Requires network access to npm registry
- **verify-demo.sh**: Docker required for build check (optional — skipped if unavailable)
- **update-stats.sh**: Runs the full test suite; may take several minutes
- **video-recording.sh**: Screen recording software running separately
