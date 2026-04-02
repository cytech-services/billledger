#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Running Bill Ledger daily maintenance..."
cd server
npm run cron:daily:dev
