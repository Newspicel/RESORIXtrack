#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# Create a backup inside the running Docker deployment and copy it to ./backups/
source "$(dirname "$0")/_common.sh"
need docker
mkdir -p "$ROOT/backups"
out=$(docker compose -f "$ROOT/docker-compose.yml" exec -T app flask resorixtrack backup)
echo "$out"
name=$(echo "$out" | sed -n 's/^Backup written: \([^ ]*\).*/\1/p')
docker compose -f "$ROOT/docker-compose.yml" cp "app:/data/backups/$name" "$ROOT/backups/$name"
c_ok "saved backups/$name"
