#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# Integration smoke test of the Docker image: start a throwaway stack, run first-time setup,
# sign in, clock in/out, request vacation, download a PDF and a backup, then tear everything down.
source "$(dirname "$0")/_common.sh"
need docker; need curl; need python3
PORT="${SMOKE_PORT:-18080}"
PROJECT="resorixtrack-smoke-$$"
TMP="$(mktemp -d)"
cat >"$TMP/.env" <<ENV
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
BACKUP_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
BASE_URL=http://localhost:$PORT
SESSION_COOKIE_SECURE=false
TRUSTED_PROXIES=0
SMTP_HOST=
RESORIXTRACK_PORT=$PORT
ENV
export RESORIXTRACK_ENV_FILE="$TMP/.env"
dc() { docker compose -p "$PROJECT" -f "$ROOT/docker-compose.yml" --env-file "$TMP/.env" "$@"; }
cleanup() { dc down -v >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
c_info "starting stack on :$PORT"
dc up -d --no-build app worker
for i in $(seq 1 60); do curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "http://localhost:$PORT/api/health" >/dev/null || { dc logs app | tail -50; c_err "app not healthy"; exit 1; }
JAR="$TMP/cookies"; B="http://localhost:$PORT/api/v1"
csrf() { awk '$6=="rt_csrf"{print $7}' "$JAR"; }
post() { curl -fsS -b "$JAR" -c "$JAR" -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf)" -X POST "$B$1" -d "$2"; }
c_info "first-run setup (needs the one-time setup code from the server log)"
dc logs app | grep -q "RESORIXtrack first-run setup" || { c_err "setup code banner missing in app log"; exit 1; }
CODE=$(dc exec -T app flask resorixtrack setup-code | grep -oE '[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}' | tail -1)
test -n "$CODE" || { c_err "could not obtain setup code"; exit 1; }
curl -sS -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" -X POST "$B/setup" \
  -d '{"company_name":"Smoke AG","timezone":"Europe/Zurich","admin_name":"Smoke Admin","admin_email":"smoke@example.com","admin_password":"Container-check-Pass-2026","holiday_preset":"ch-fr-fribourg","setup_code":"WRONG-CODE-0000"}' | grep -q 403
curl -fsS -c "$JAR" -H "Content-Type: application/json" -X POST "$B/setup" \
  -d "{\"company_name\":\"Smoke AG\",\"timezone\":\"Europe/Zurich\",\"admin_name\":\"Smoke Admin\",\"admin_email\":\"smoke@example.com\",\"admin_password\":\"Container-check-Pass-2026\",\"holiday_preset\":\"ch-fr-fribourg\",\"setup_code\":\"$CODE\"}" >/dev/null
curl -fsS -b "$JAR" "$B/me" | grep -q smoke@example.com
c_info "clock in / out"
post /clock/start '{}' | grep -q '"working"'
post /clock/stop '{}' | grep -q '"idle"'
c_info "vacation request"
post /absences '{"type":"vacation","start_date":"2030-03-04","end_date":"2030-03-08"}' | grep -q '"approved"'
c_info "PDF report + backup download"
Y=$(date +%Y); M=$(date +%-m)
curl -fsS -b "$JAR" "$B/reports/timesheet?year=$Y&month=$M&format=pdf" -o "$TMP/t.pdf"; head -c4 "$TMP/t.pdf" | grep -q '%PDF'
curl -fsS -b "$JAR" -H "X-CSRF-Token: $(csrf)" -X POST "$B/admin/backups/download" -o "$TMP/b.enc"
head -c4 "$TMP/b.enc" | grep -q 'RTBK' || { c_err "backup download is not an encrypted archive"; exit 1; }
! grep -q 'SQLite format 3' "$TMP/b.enc" || { c_err "backup download contains plaintext"; exit 1; }
c_info "encrypted backup decrypts inside the container with BACKUP_PASSWORD"
latest=$(dc exec -T app sh -c 'ls -t /data/backups | head -1' | tr -d '\r')
dc exec -T app flask resorixtrack decrypt-backup "/data/backups/$latest" -o /tmp/plain.zip >/dev/null
dc exec -T app python3 -c "import zipfile; z = zipfile.ZipFile('/tmp/plain.zip'); assert z.testzip() is None and 'resorixtrack.db' in z.namelist()"
c_info "frontend is served with a strict CSP and vendored API docs"
curl -fsS "http://localhost:$PORT/login" | grep -q 'astro-island'
curl -fsSI "http://localhost:$PORT/login" | grep -i "content-security-policy" | grep -q "script-src 'self' 'sha256-"
curl -fsSI "http://localhost:$PORT/login" | grep -i "content-security-policy" | grep -qv "unsafe-inline'; style" || true
curl -sS -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/openapi.json" | grep -q 401
curl -fsS -b "$JAR" "http://localhost:$PORT/api/docs" | grep -q '/vendor/swagger-ui/'
c_info "worker is running and becomes healthy"
dc ps worker | grep -q -i "up\|running"
for i in $(seq 1 60); do dc ps worker | grep -q "(healthy)" && break; sleep 2; done
dc ps worker | grep -q "(healthy)" || { dc ps worker; c_err "worker did not become healthy"; exit 1; }
c_ok "smoke test passed"
