#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# Local development: Mailpit (Docker, optional) + Flask API (debug, auto-reload) + Astro dev server (HMR).
#   App:      http://localhost:4321   (proxies /api to Flask)
#   API:      http://localhost:5000/api/docs
#   Mailpit:  http://localhost:8025
source "$(dirname "$0")/_common.sh"
[ -x "$FLASK" ] || { c_err "run 'make setup' first"; exit 1; }
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  c_info "starting Mailpit"
  if ! docker compose -f "$ROOT/docker-compose.dev.yml" up -d >/dev/null 2>&1; then
    if curl -fsS http://127.0.0.1:8025 >/dev/null 2>&1; then
      c_info "ports 1025/8025 are already in use - another Mailpit (e.g. from an older checkout) is running; using it"
    else
      c_err "could not start Mailpit: ports 1025/8025 are in use by something else. Stop it, or run without Docker (emails fail to send)."
      docker compose -f "$ROOT/docker-compose.dev.yml" up -d 2>&1 | tail -3
      exit 1
    fi
  fi
else
  c_info "Docker not available - emails will fail to send (start an SMTP server on :1025)"
fi
"$FLASK" resorixtrack migrate --no-backup >/dev/null
export SESSION_COOKIE_SECURE=false TRUSTED_PROXIES=0 BASE_URL="${BASE_URL:-http://localhost:4321}"
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null; }
trap cleanup EXIT INT TERM
(cd "$ROOT/backend" && exec "$FLASK" run --debug --port "${API_PORT:-5000}") & pids+=($!)
(cd "$ROOT/frontend" && RESORIXTRACK_BACKEND="http://127.0.0.1:${API_PORT:-5000}" exec npm run dev --silent) & pids+=($!)
c_ok "RESORIXtrack dev: http://localhost:4321  ·  API docs: http://localhost:${API_PORT:-5000}/api/docs  ·  Mail: http://localhost:8025"
wait -n "${pids[@]}"
