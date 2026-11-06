# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Company branding: public logo/accent lookup, admin uploads."""

from __future__ import annotations

from flask import jsonify, request, send_file
from flask_smorest import Blueprint
from marshmallow import EXCLUDE, Schema, fields, validate

from ..auth import admin_required
from ..errors import Validation
from ..extensions import db
from ..services import branding
from .common import ok

bp = Blueprint("branding", __name__, url_prefix="/api/v1/branding", description="Company branding")

# Served inline but fully sandboxed: an uploaded SVG can never run scripts or load remote content.
LOGO_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"


class AccentIn(Schema):
    class Meta:
        unknown = EXCLUDE

    accent = fields.String(allow_none=True, validate=validate.Regexp(r"^#[0-9a-fA-F]{6}$|^$"))


@bp.route("", methods=["GET"])
def get_branding():
    """Public: company name, accent colour and logo URLs (used by the login page before sign-in)."""
    return jsonify(branding.info())


@bp.route("/logo/<string:variant>", methods=["GET"])
def logo(variant: str):
    """Public: the logo for dark or light backgrounds (custom upload or built-in default)."""
    path = branding.logo_path(variant)
    resp = send_file(path, mimetype=branding.mimetype(path), max_age=300, conditional=True)
    resp.headers["Cache-Control"] = "public, max-age=300"
    resp.headers["Content-Disposition"] = f'inline; filename="logo-{variant}{path.suffix}"'
    resp.headers["Content-Security-Policy"] = LOGO_CSP
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@bp.route("/logo/<string:variant>", methods=["PUT", "POST"])
@admin_required
def upload_logo(variant: str):
    """Admin: upload a logo (multipart field `file`, SVG or PNG, max 512 KB)."""
    f = request.files.get("file")
    if f is None:
        raise Validation("No file uploaded", fields={"file": "required"})
    return ok(branding.save_logo(variant, f))


@bp.route("/logo/<string:variant>", methods=["DELETE"])
@admin_required
def delete_logo(variant: str):
    """Admin: remove the custom logo and fall back to the default."""
    return ok(branding.delete_logo(variant))


@bp.route("", methods=["PATCH"])
@admin_required
@bp.arguments(AccentIn)
def patch_branding(data):
    """Admin: set the accent colour (`#rrggbb`), or empty / null for the default."""
    result = branding.set_accent(data.get("accent"))
    db.session.commit()
    return jsonify(result)
