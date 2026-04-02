#!/bin/bash
cd "$(dirname "$0")"

echo "Checking for existing Bill Ledger processes..."

# Stop any legacy API processes (older Node entrypoint)
LEGACY_API_PIDS=$(pgrep -f "node src/index.js" || true)
if [ -n "$LEGACY_API_PIDS" ]; then
  echo "Stopping legacy API process(es): $LEGACY_API_PIDS"
  kill $LEGACY_API_PIDS 2>/dev/null || true
  sleep 1
fi

# Stop any current TS API dev processes (tsx watch)
TS_API_PIDS=$(pgrep -f "tsx watch src/server.ts" || true)
if [ -n "$TS_API_PIDS" ]; then
  echo "Stopping TS API process(es): $TS_API_PIDS"
  kill $TS_API_PIDS 2>/dev/null || true
  sleep 1
fi

# Stop any Nuxt dev processes (prevents port conflicts)
NUXT_PIDS=$(pgrep -f "nuxt dev" || true)
if [ -n "$NUXT_PIDS" ]; then
  echo "Stopping Nuxt dev process(es): $NUXT_PIDS"
  kill $NUXT_PIDS 2>/dev/null || true
  sleep 1
fi

echo "Starting Bill Ledger API (TypeScript/Express)..."
(cd server && npm run dev) &
API_PID=$!

cleanup() {
  echo ""
  echo "Stopping API..."
  kill "$API_PID" 2>/dev/null
}

trap cleanup EXIT INT TERM

echo "Starting Bill Ledger Frontend (Nuxt)..."
cd frontend && npm run dev
