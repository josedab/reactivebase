#!/usr/bin/env bash
# Counts packages and tests, then prints current stats.
# Usage: ./scripts/update-stats.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PKG_COUNT=$(ls -d packages/*/ | wc -l | tr -d ' ')
echo "Packages: $PKG_COUNT"

TEST_OUTPUT=$(npx turbo run test --force 2>&1 || true)
TEST_COUNT=$(echo "$TEST_OUTPUT" | grep "Tests " | sed 's/.*Tests  //' | sed 's/ passed.*//' | awk '{sum+=$1} END {print sum}')
echo "Tests: $TEST_COUNT"

echo ""
echo "To update docs, replace old counts in:"
echo "  README.md, CONTRIBUTING.md, LAUNCH_CHECKLIST.md"
echo "with: $PKG_COUNT packages, $TEST_COUNT tests"
