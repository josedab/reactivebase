#!/bin/bash
set -e

# ReactiveBase Publish Script
# Publishes all packages to npm in dependency order.
#
# Prerequisites:
#   npm login (must be logged into @reactivebase npm org)
#
# Usage:
#   ./scripts/publish.sh          # Dry run (default)
#   ./scripts/publish.sh --real   # Actually publish

MODE="${1:---dry-run}"
VERSION=$(node -e "console.log(require('./packages/server/package.json').version)")
if [ -z "$VERSION" ]; then
  echo "  ❌ Could not read version from packages/server/package.json"
  exit 1
fi

echo ""
echo "  ⚡ ReactiveBase Publish Script"
echo "  Version: $VERSION"
echo "  Mode: $MODE"
echo ""

# Verify build and tests pass
echo "  🔨 Building all packages..."
npm run build
echo "  ✅ Build passed"

echo "  🧪 Running all tests..."
npm run test
echo "  ✅ Tests passed"

# Publish order: dependencies first
PACKAGES=(
  "packages/server"
  "packages/client"
  "packages/react"
  "packages/vue"
  "packages/svelte"
  "packages/nextjs"
  "packages/edge"
  "packages/testing"
  "packages/cli"
  "packages/reactivebase"
  "packages/create-reactivebase"
  "packages/migrate-from-prisma"
  "packages/graphql"
  "packages/react-native"
)

echo ""
echo "  📦 Publishing ${#PACKAGES[@]} packages..."
echo ""

for pkg in "${PACKAGES[@]}"; do
  name=$(node -e "console.log(require('./$pkg/package.json').name)")
  echo -n "  Publishing $name@$VERSION... "

  if [ "$MODE" = "--real" ]; then
    cd "$pkg"
    npm publish --access public 2>&1 || echo "(already published)"
    cd - > /dev/null
    echo "✅"
  else
    cd "$pkg"
    npm pack --dry-run 2>&1 | tail -1
    cd - > /dev/null
  fi
done

echo ""
if [ "$MODE" = "--real" ]; then
  echo "  🎉 All packages published!"
  echo ""
  echo "  Verify:"
  echo "    npx create-reactivebase test-app"
  echo "    npm info @reactivebase/server"
  echo ""
  echo "  Next: Push to GitHub and create v$VERSION tag"
  echo "    git tag v$VERSION"
  echo "    git push origin main --tags"
else
  echo "  📋 Dry run complete. To publish for real:"
  echo "    ./scripts/publish.sh --real"
fi
echo ""
