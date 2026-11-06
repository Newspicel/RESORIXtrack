# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from flask import Response, g, jsonify

from ..models import User
from ..timeutil import ensure_aware


def me() -> User:
    return g.user


def aware(dt: datetime | None, tz: str) -> datetime | None:
    return ensure_aware(dt, tz) if dt is not None else None


def ok(data: Any = None, status: int = 200) -> tuple[Response, int]:
    return jsonify(data if data is not None else {"ok": True}), status


def file_response(content: bytes, mimetype: str, filename: str, inline: bool = False) -> Response:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename)
    resp = Response(content, mimetype=mimetype)
    resp.headers["Content-Disposition"] = f'{"inline" if inline else "attachment"}; filename="{safe}"'
    resp.headers["Cache-Control"] = "private, no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


MIMETYPES = {
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv; charset=utf-8",
}
