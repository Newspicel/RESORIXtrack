#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# Full test run: lint, backend unit+integration tests (coverage), frontend unit tests, build, browser E2E tests.
#   scripts/test.sh            everything
#   scripts/test.sh backend    only lint + pytest
#   scripts/test.sh frontend   only vitest + build
#   scripts/test.sh e2e        only Playwright (builds the frontend first)
source "$(dirname "$0")/_common.sh"
what="${1:-all}"
run_backend() {
  c_info "ruff"; (cd "$ROOT/backend" && "$VENV/bin/ruff" check resorixtrack tests)
  c_info "third-party licenses"; "$VENV/bin/python" "$ROOT/scripts/licenses.py" --check
  c_info "pytest (unit + API integration, coverage)"
  (cd "$ROOT/backend" && "$VENV/bin/pytest" --cov=resorixtrack --cov-report=term-missing:skip-covered --cov-fail-under=85 -p no:cacheprovider)
}
run_frontend() {
  c_info "vitest"; (cd "$ROOT/frontend" && npx vitest run)
  c_info "i18n completeness"; (cd "$ROOT/frontend" && node scripts/i18n-check.mjs)
  c_info "astro build"; (cd "$ROOT/frontend" && npm run build --silent >/dev/null)
}
run_e2e() {
  [ -f "$ROOT/frontend/dist/index.html" ] || (cd "$ROOT/frontend" && npm run build --silent >/dev/null)
  c_info "playwright E2E"; (cd "$ROOT/frontend" && npx playwright test)
}
case "$what" in
  backend) run_backend ;;
  frontend) run_frontend ;;
  e2e) run_e2e ;;
  all) run_backend; run_frontend; run_e2e ;;
  *) c_err "unknown target $what"; exit 2 ;;
esac
c_ok "tests passed ($what)"
