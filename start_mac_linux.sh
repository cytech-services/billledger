#!/bin/bash
cd "$(dirname "$0")"

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
