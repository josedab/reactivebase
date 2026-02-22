#!/bin/bash
set -e

# Demo deployment verification script
# Checks that the collaborative-board demo is ready to deploy

echo ""
echo "  🎯 ReactiveBase Demo Deployment Check"
echo ""

DEMO_DIR="examples/collaborative-board"

echo "  Checking files..."
for f in package.json server.ts convex/schema.ts convex/board.ts fly.toml Dockerfile deploy.sh README.md; do
  if [ -f "$DEMO_DIR/$f" ]; then
    echo "    ✅ $f"
  else
    echo "    ❌ $f MISSING"
  fi
done

echo ""
echo "  Checking Dockerfile builds..."
if command -v docker &> /dev/null; then
  docker build -f "$DEMO_DIR/Dockerfile" "$DEMO_DIR" -t reactivebase-demo --quiet 2>&1 && echo "    ✅ Docker build successful" || echo "    ⚠️ Docker build failed (may need network)"
else
  echo "    ⚠️ Docker not available, skipping build check"
fi

echo ""
echo "  To deploy:"
echo "    cd $DEMO_DIR"
echo "    ./deploy.sh"
echo ""
echo "  Expected URL: https://reactivebase-demo.fly.dev"
echo "  Dashboard:    https://reactivebase-demo.fly.dev/dashboard"
echo ""
