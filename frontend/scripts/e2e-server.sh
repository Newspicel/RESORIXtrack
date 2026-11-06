#!/usr/bin/env bash
# Starts a throwaway backend (fresh DB with demo data) serving the built frontend, for Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="$(mktemp -d -t resorixtrack-e2e-XXXXXX)"
trap 'rm -rf "$DATA"' EXIT
export RESORIXTRACK_ENV=development RESORIXTRACK_DATA_DIR="$DATA" FRONTEND_DIST="$ROOT/frontend/dist" \
  SESSION_COOKIE_SECURE=false TRUSTED_PROXIES=0 SMTP_HOST= LOG_LEVEL=WARNING LOGIN_MAX_FAILURES=50 \
  FLASK_APP="resorixtrack:create_app('development')"
cd "$ROOT/backend"
"$ROOT/.venv/bin/flask" resorixtrack migrate --no-backup >/dev/null
"$ROOT/.venv/bin/flask" resorixtrack seed-demo >/dev/null
exec "$ROOT/.venv/bin/flask" run --port "${E2E_PORT:-5099}" --no-reload
