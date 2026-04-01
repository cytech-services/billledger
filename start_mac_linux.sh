#!/bin/bash
cd "$(dirname "$0")"

echo "Checking for existing Bill Ledger API processes..."
EXISTING_API_PIDS=$(pgrep -f "node src/index.js" || true)
if [ -n "$EXISTING_API_PIDS" ]; then
  echo "Stopping existing API process(es): $EXISTING_API_PIDS"
  kill $EXISTING_API_PIDS 2>/dev/null || true
  sleep 1
fi

echo "Starting Bill Ledger API (Node/Express)..."
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
