#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# Build the production Docker image: resorixtrack:<version> and resorixtrack:latest
source "$(dirname "$0")/_common.sh"
need docker
VERSION="${VERSION:-$(grep -m1 '^version' "$ROOT/backend/pyproject.toml" | cut -d'"' -f2)}"
GIT=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)
c_info "building resorixtrack:$VERSION ($GIT)"
docker build -f "$ROOT/docker/Dockerfile" --build-arg VERSION="$VERSION+$GIT" -t "resorixtrack:$VERSION" -t resorixtrack:latest "$ROOT"
c_ok "built resorixtrack:$VERSION"
