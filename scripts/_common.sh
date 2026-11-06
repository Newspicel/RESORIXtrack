# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# Shared helpers for RESORIXtrack scripts (sourced).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/.venv"
PY="$VENV/bin/python"
FLASK="$VENV/bin/flask"
export FLASK_APP="resorixtrack:create_app('development')"
export RESORIXTRACK_ENV="${RESORIXTRACK_ENV:-development}"
export RESORIXTRACK_DATA_DIR="${RESORIXTRACK_DATA_DIR:-$ROOT/var}"
c_info() { printf '\033[36m▸ %s\033[0m\n' "$*"; }
c_ok() { printf '\033[32m✔ %s\033[0m\n' "$*"; }
c_err() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || { c_err "missing dependency: $1"; exit 1; }; }
