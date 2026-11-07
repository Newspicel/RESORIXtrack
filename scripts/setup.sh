#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# One-time local setup: Python venv + backend deps, frontend deps, Playwright browser.
source "$(dirname "$0")/_common.sh"
need python3; need npm
if [ ! -x "$PY" ]; then c_info "creating virtualenv in .venv"; python3 -m venv "$VENV"; fi
c_info "installing backend: runtime packages exactly as in the Docker image (requirements.lock), then dev tools"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q --require-hashes --no-deps -r "$ROOT/backend/requirements.lock"
"$VENV/bin/pip" install -q -e "$ROOT/backend[dev]"  # satisfied by the locked versions; adds pytest, ruff
c_info "installing frontend dependencies"
(cd "$ROOT/frontend" && npm ci --no-audit --no-fund)
if [ "${SKIP_PLAYWRIGHT:-0}" != "1" ]; then
  c_info "installing Playwright Chromium (set SKIP_PLAYWRIGHT=1 to skip)"
  (cd "$ROOT/frontend" && npx playwright install chromium)
fi
mkdir -p "$RESORIXTRACK_DATA_DIR"
c_info "applying database migrations ($RESORIXTRACK_DATA_DIR)"
"$FLASK" resorixtrack migrate --no-backup
c_ok "setup complete - run 'make seed' for demo data and 'make dev' to start"
