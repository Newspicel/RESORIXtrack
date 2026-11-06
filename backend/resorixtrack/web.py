# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Serves the built Astro frontend, health endpoint and security headers."""

from __future__ import annotations

import base64
import hashlib
import re
from pathlib import Path

from flask import Flask, Response, g, jsonify, request, send_file
from sqlalchemy import text

from . import __version__
from .extensions import db

# Scripts: only our own files plus the hashes of the few inline bootstrap scripts Astro emits
# (computed from the built HTML at startup, see _inline_script_hashes). No 'unsafe-inline'.
CSP_APP = ("default-src 'self'; script-src 'self'{script_hashes}; style-src 'self' 'unsafe-inline'; "
           "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; "
           "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
# Swagger UI (vendored under /vendor/swagger-ui) needs inline scripts/styles of its own.
CSP_DOCS = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
_INLINE_SCRIPT = re.compile(r"<script>(.*?)</script>", re.S)


def _dist(app: Flask) -> Path | None:
    configured = app.config.get("FRONTEND_DIST")
    candidates = [Path(configured)] if configured else []
    candidates.append(Path(__file__).resolve().parents[2] / "frontend" / "dist")
    for c in candidates:
        if (c / "index.html").exists():
            return c
    return None


def _inline_script_hashes(dist: Path | None) -> str:
    """CSP source list for the inline scripts in the built frontend (Astro's island loaders)."""
    hashes: set[str] = set()
    if dist is not None:
        for html in dist.rglob("*.html"):
            for m in _INLINE_SCRIPT.finditer(html.read_text(encoding="utf-8")):
                digest = base64.b64encode(hashlib.sha256(m.group(1).encode("utf-8")).digest()).decode()
                hashes.add(f"'sha256-{digest}'")
    return "".join(f" {h}" for h in sorted(hashes))


def init_web(app: Flask) -> None:
    app.extensions["csp_app"] = CSP_APP.format(script_hashes=_inline_script_hashes(_dist(app)))

    @app.before_request
    def docs_require_login():
        # The interactive API docs and the spec are for signed-in users only (less surface for strangers).
        if (request.path.startswith("/api/docs") or request.path == "/api/openapi.json") and g.get("user") is None:
            return jsonify({"error": {"code": "unauthorized", "message": "Sign in to view the API documentation"}}), 401
        return None

    @app.route("/api/health")
    def health():
        try:
            db.session.execute(text("SELECT 1"))
            ok = True
        except Exception:  # noqa: BLE001  # pragma: no cover
            ok = False
        return jsonify({"status": "ok" if ok else "degraded", "version": __version__}), (200 if ok else 503)

    @app.after_request
    def security_headers(resp: Response) -> Response:
        h = resp.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("Referrer-Policy", "same-origin")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        h.setdefault("Content-Security-Policy",
                     CSP_DOCS if request.path.startswith("/api/docs") else app.extensions["csp_app"])
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        h.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        if request.is_secure:
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if request.path.startswith("/api/") and "Cache-Control" not in h:
            h["Cache-Control"] = "no-store"
        return resp

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def frontend(path: str):
        if path.startswith("api/"):
            return jsonify({"error": {"code": "not_found", "message": "Not found"}}), 404
        dist = _dist(app)
        if dist is None:
            return Response("RESORIXtrack API is running. The frontend is not built "
                            "(run `make build-frontend` or use the dev server on :4321).",
                            mimetype="text/plain")
        root = dist.resolve()
        candidates = [root / path, root / path / "index.html", root / f"{path}.html"]
        for c in candidates:
            c = c.resolve()
            if (root in c.parents or c == root) and c.is_file():
                resp = send_file(c, max_age=0)
                if "/_astro/" in f"/{path}":
                    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
                elif c.suffix == ".html":
                    resp.headers["Cache-Control"] = "no-cache"
                else:
                    resp.headers["Cache-Control"] = "public, max-age=3600"
                return resp
        not_found = root / "404.html"
        if not_found.exists():
            return send_file(not_found, max_age=0), 404
        return Response("Not found", status=404, mimetype="text/plain")
