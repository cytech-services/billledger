#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRON_CMD="bash \"$ROOT_DIR/run_daily_maintenance.sh\" >> \"$ROOT_DIR/logs/cron_daily.log\" 2>&1"
CRON_EXPR="17 2 * * *"
CRON_ENTRY="$CRON_EXPR $CRON_CMD"

mkdir -p "$ROOT_DIR/logs"

CURRENT_CRON="$(crontab -l 2>/dev/null || true)"

if printf '%s\n' "$CURRENT_CRON" | rg -F "$CRON_CMD" >/dev/null; then
  echo "Cron entry already exists."
  exit 0
fi

{
  printf '%s\n' "$CURRENT_CRON"
  printf '%s\n' "$CRON_ENTRY"
} | crontab -

echo "Installed cron entry:"
echo "$CRON_ENTRY"
