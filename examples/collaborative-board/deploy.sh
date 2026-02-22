#!/bin/bash
set -e

echo "🚀 Deploying ReactiveBase Collaborative Board Demo"
echo ""

# Check fly CLI
if ! command -v fly &> /dev/null; then
  echo "❌ Fly CLI not found. Install: https://fly.io/docs/hands-on/install-flyctl/"
  exit 1
fi

# Launch app if not exists
if ! fly status --app reactivebase-demo &> /dev/null; then
  echo "📦 Creating Fly app..."
  fly launch --config fly.toml --no-deploy --copy-config

  echo "🐘 Creating Postgres database..."
  fly postgres create --name reactivebase-demo-db --region iad --vm-size shared-cpu-1x --initial-cluster-size 1
  fly postgres attach reactivebase-demo-db --app reactivebase-demo
fi

echo "🚢 Deploying..."
fly deploy --app reactivebase-demo

echo ""
echo "✅ Deployed!"
echo ""
echo "  App:       https://reactivebase-demo.fly.dev"
echo "  Dashboard: https://reactivebase-demo.fly.dev/dashboard"
echo "  Metrics:   https://reactivebase-demo.fly.dev/metrics"
echo "  WebSocket: wss://reactivebase-demo.fly.dev/ws"
