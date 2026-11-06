#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# Produces the screenshots used in README.md and docs/ from a throwaway, freshly seeded instance.
#   scripts/screenshots.sh            -> docs/screenshots/*.png
# Requires `make setup` (venv, node modules, Playwright Chromium) and a built frontend (`make build-frontend`).
source "$(dirname "$0")/_common.sh"
OUT="$ROOT/docs/screenshots"
PORT="${SHOT_PORT:-5098}"
mkdir -p "$OUT"
[ -f "$ROOT/frontend/dist/index.html" ] || { c_info "building frontend"; (cd "$ROOT/frontend" && npm run build --silent >/dev/null); }
if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
  c_err "something already listens on :$PORT (a leftover server would serve old code) – stop it or set SHOT_PORT"; exit 1
fi
c_info "starting a seeded throwaway instance on :$PORT"
# setsid: own process group, so the trap stops the whole tree (the shell wrapper AND the flask server behind it)
E2E_PORT="$PORT" setsid "$ROOT/frontend/scripts/e2e-server.sh" >/dev/null 2>&1 &
SERVER=$!
trap 'kill -- -$SERVER 2>/dev/null; wait $SERVER 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://localhost:$PORT/api/health" >/dev/null || { c_err "instance did not start"; exit 1; }
B="http://localhost:$PORT"
PW="demo"
shot() { # shot <theme> <email> <outprefix> <paths...>
  local theme="$1" email="$2" prefix="$3"; shift 3
  local tmp; tmp="$(mktemp -d)"
  (cd "$ROOT/frontend" && THEME="$theme" LOCALE=en WIDTH=1440 HEIGHT=900 node scripts/screenshot.mjs "$B" "$email" "$PW" "$tmp" "$@" >/dev/null)
  for f in "$tmp"/*.png; do mv "$f" "$OUT/${prefix}-$(basename "$f")"; done
  rm -rf "$tmp"
}
c_info "login page"
(cd "$ROOT/frontend" && THEME=dark LOCALE=en node scripts/screenshot.mjs "$B" "" "" "$OUT" /login >/dev/null && mv "$OUT/login.png" "$OUT/login-dark.png")
(cd "$ROOT/frontend" && THEME=light LOCALE=en node scripts/screenshot.mjs "$B" "" "" "$OUT" /login >/dev/null && mv "$OUT/login.png" "$OUT/login-light.png")
c_info "employee pages"
shot dark  marc.dubois@example.nomail employee-dark  / /time "/time?view=month" /absences /account /profile
shot light marc.dubois@example.nomail employee-light / /time /absences
c_info "team lead pages"
shot dark luca.bianchi@example.nomail lead-dark /team /team/approvals /team/signoff /reports
c_info "administrator pages"
shot dark admin@example.nomail admin-dark /admin/users /admin/teams /admin/holidays /admin/settings /admin/backups
c_info "mobile"
(cd "$ROOT/frontend" && THEME=dark LOCALE=en WIDTH=414 HEIGHT=880 node scripts/screenshot.mjs "$B" marc.dubois@example.nomail "$PW" "$OUT" / >/dev/null && mv "$OUT/home.png" "$OUT/mobile-dashboard.png")
c_ok "screenshots written to $OUT"
ls -1 "$OUT"
