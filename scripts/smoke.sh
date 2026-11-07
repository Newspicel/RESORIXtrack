#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# Smoke test of the production image: start app + worker from docker-compose.yml with a throwaway .env, wait
# for /api/health, fetch the sign-in page, check that a form POST to /login (a submit before hydration) is
# neither an error nor echoed, print a setup code with `rt setup-code` in the container, tear everything down.
#   docker compose build && scripts/smoke.sh
#   SMOKE_IMAGE=resorixtrack:v2-test SMOKE_PORT=18080 scripts/smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for tool in docker curl openssl; do
  command -v "$tool" >/dev/null || { echo "smoke: $tool is required" >&2; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo "smoke: docker compose v2 is required" >&2; exit 1; }
IMAGE="${SMOKE_IMAGE:-resorixtrack:latest}"
PORT="${SMOKE_PORT:-18080}"
PROJECT="resorixtrack-smoke-$$"
TMP="$(mktemp -d)"
cat >"$TMP/.env" <<ENV
SECRET_KEY=$(openssl rand -hex 32)
BACKUP_PASSWORD=$(openssl rand -hex 16)
BASE_URL=http://localhost:$PORT
SESSION_COOKIE_SECURE=false
TRUSTED_PROXIES=0
SMTP_HOST=
RESORIXTRACK_PORT=$PORT
RESORIXTRACK_IMAGE=$IMAGE
ENV
export RESORIXTRACK_ENV_FILE="$TMP/.env"
dc() { docker compose -p "$PROJECT" -f "$ROOT/docker-compose.yml" --env-file "$TMP/.env" "$@"; }
fail() { echo "smoke: $*" >&2; dc logs --tail 50 app worker >&2 || true; exit 1; }
cleanup() { dc down -v --timeout 10 >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "smoke: starting $IMAGE on :$PORT"
dc up -d --no-build app worker
B="http://localhost:$PORT"
for _ in $(seq 1 60); do curl -fsS "$B/api/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "$B/api/health" | grep -q '"status":"ok"' || fail "app not healthy"
curl -fsSL "$B/login" | grep -qi "<html" || fail "sign-in page not served" # redirects to /setup until set up

# a form submit before hydration: credentials travel in the body, never in a URL, never in the answer
status=$(curl -sS -o "$TMP/post.html" -w '%{http_code}' -X POST --data 'email=smoke@example.nomail&password=Smoke-only-pw-1' "$B/login")
[ "$status" -lt 500 ] || fail "POST /login answered $status"
echo "smoke: POST /login answered $status"
! grep -q 'Smoke-only-pw-1' "$TMP/post.html" || fail "POST /login echoes the password"

echo "smoke: setup code"
code=$(dc exec -T app rt setup-code | grep -oE '[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}' | tail -1)
[ -n "$code" ] || fail "rt setup-code printed no code"
dc ps --status running --services | grep -qx worker || fail "worker is not running"
echo "smoke: ok"
