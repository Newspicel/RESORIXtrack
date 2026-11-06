# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Uniform JSON error responses: ``{"error": {"code", "message", "fields"?}}``."""

from __future__ import annotations

from typing import Any

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException


class ApiError(Exception):
    status = 400
    code = "bad_request"

    def __init__(self, message: str, *, code: str | None = None, status: int | None = None,
                 fields: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status:
            self.status = status
        self.fields = fields

    def to_response(self):
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fields:
            body["fields"] = self.fields
        return jsonify({"error": body}), self.status


class Unauthorized(ApiError):
    status = 401
    code = "unauthorized"


class Forbidden(ApiError):
    status = 403
    code = "forbidden"


class NotFound(ApiError):
    status = 404
    code = "not_found"


class Conflict(ApiError):
    status = 409
    code = "conflict"


class Validation(ApiError):
    status = 422
    code = "validation_error"


class TooManyRequests(ApiError):
    status = 429
    code = "too_many_requests"


def _flatten_webargs(errors: Any) -> dict[str, Any]:
    """webargs nests errors by location: {"json": {"field": ["msg"]}} -> {"field": "msg"}."""
    out: dict[str, Any] = {}
    if not isinstance(errors, dict):
        return out
    for _location, fields in errors.items():
        if isinstance(fields, dict):
            for k, v in fields.items():
                out[k] = v[0] if isinstance(v, list) and v and isinstance(v[0], str) else v
    return out


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def _api_error(err: ApiError):
        return err.to_response()

    from sqlalchemy.exc import DatabaseError

    @app.errorhandler(DatabaseError)
    def _db_error(err: DatabaseError):
        from .db_guards import is_guard_error
        from .extensions import db

        db.session.rollback()
        code = is_guard_error(err)
        if code:
            app.logger.warning("database guard rejected a write: %s", code)
            return Conflict("This change is not allowed: the period has been signed off" if code == "period_signed_off"
                            else "Protected records cannot be changed", code=code).to_response()
        app.logger.exception("Database error")
        return jsonify({"error": {"code": "server_error", "message": "Internal server error"}}), 500

    @app.errorhandler(HTTPException)
    def _http_error(err: HTTPException):
        status = err.code or 500
        data = getattr(err, "data", None) or {}
        if status == 422:
            fields = _flatten_webargs(data.get("messages") or data.get("errors"))
            return Validation("Validation failed", fields=fields).to_response()
        code = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
                405: "method_not_allowed", 409: "conflict", 413: "payload_too_large",
                429: "too_many_requests"}.get(status, "http_error")
        message = data.get("message") or err.description or err.name
        return jsonify({"error": {"code": code, "message": message}}), status

    @app.errorhandler(Exception)
    def _unhandled(err: Exception):  # pragma: no cover - defensive
        if isinstance(err, HTTPException):
            return _http_error(err)
        app.logger.exception("Unhandled error")
        return jsonify({"error": {"code": "server_error", "message": "Internal server error"}}), 500
