#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# Restore an encrypted backup (.zip.enc) into the Docker deployment: stops the stack, restores, starts again.
#   scripts/restore.sh backups/resorixtrack-20261105-020000-auto.zip.enc
# The container decrypts with BACKUP_PASSWORD from .env; for an archive made with an earlier password run
# the restore command manually with --ask-password (see docs/backup-restore.md).
source "$(dirname "$0")/_common.sh"
need docker
[ -f "${1:-}" ] || { c_err "usage: $0 <backup.zip.enc>"; exit 2; }
DC="docker compose -f $ROOT/docker-compose.yml"
read -r -p "This replaces the current RESORIXtrack database. Continue? [y/N] " yn
[ "$yn" = "y" ] || [ "$yn" = "Y" ] || exit 1
$DC stop app worker
$DC run --rm --no-deps -v "$(cd "$(dirname "$1")" && pwd)/$(basename "$1"):/tmp/restore.zip.enc:ro" app \
  flask resorixtrack restore /tmp/restore.zip.enc --yes
$DC up -d
c_ok "restored $(basename "$1")"
