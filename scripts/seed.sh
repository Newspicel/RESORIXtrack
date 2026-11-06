#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# Demo data (teams, people, 3 months of entries, Fribourg holidays). Development only.
source "$(dirname "$0")/_common.sh"
if [ "${1:-}" = "--reset" ]; then
  c_info "resetting $RESORIXTRACK_DATA_DIR"; rm -f "$RESORIXTRACK_DATA_DIR"/resorixtrack.db*; rm -rf "$RESORIXTRACK_DATA_DIR/attachments"
fi
mkdir -p "$RESORIXTRACK_DATA_DIR"
"$FLASK" resorixtrack migrate --no-backup >/dev/null
"$FLASK" resorixtrack seed-demo
