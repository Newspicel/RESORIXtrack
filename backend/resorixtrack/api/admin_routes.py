# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Administration: settings, SMTP test, backups, period locks, audit log."""

from __future__ import annotations

from datetime import timedelta

from flask import current_app, jsonify, send_file
from flask_smorest import Blueprint

from ..auth import admin_required
from ..errors import ApiError, NotFound
from ..extensions import db
from ..models import Holiday, HolidayCalendar, Revision, Setting, Team, User
from ..services import backup as backup_svc
from ..services import branding, mail, revisions
from ..services import settings as settings_svc
from ..timeutil import range_bounds_utc, utcnow
from . import schemas as s
from .common import me, ok

bp = Blueprint("admin", __name__, url_prefix="/api/v1/admin", description="Administration (admin only)")
ADMIN_AUDIT_ENTITIES = ("user", "team", "team_lead", "project", "api_token", "signoff")


@bp.route("/settings", methods=["GET"])
@admin_required
def get_settings():
    return jsonify(settings_svc.get_all())


@bp.route("/settings", methods=["PATCH"])
@admin_required
@bp.arguments(s.SettingsIn)
def patch_settings(data):
    if "holiday_work_surcharge_percent" in data:
        data["holiday_work_surcharge_percent"] = float(data["holiday_work_surcharge_percent"])
    result = settings_svc.update(data)
    db.session.commit()
    return jsonify(result)


@bp.route("/smtp", methods=["GET"])
@admin_required
def smtp_info():
    cfg = current_app.config
    return jsonify({"host": cfg["SMTP_HOST"], "port": cfg["SMTP_PORT"], "security": cfg["SMTP_SECURITY"],
                    "user": cfg["SMTP_USER"], "from": cfg["MAIL_FROM"], "configured": bool(cfg["SMTP_HOST"])})


@bp.route("/smtp/test", methods=["POST"])
@admin_required
@bp.arguments(s.SmtpTestIn)
def smtp_test(data):
    """Send a test email synchronously and report SMTP errors."""
    to = (data.get("to") or me().email).strip()
    if not current_app.config["SMTP_HOST"] and not current_app.config.get("TESTING"):
        raise ApiError("SMTP is not configured (set SMTP_HOST in the environment)", code="smtp_not_configured")
    m = mail.build("test", to, me().locale, user=me())
    try:
        mail.deliver(current_app._get_current_object(), m)
    except Exception as exc:  # noqa: BLE001
        raise ApiError(f"Sending failed: {exc}", code="smtp_failed", status=502) from exc
    return ok({"sent_to": to})


# --------------------------------------------------------------------------- backups

@bp.route("/backups", methods=["GET"])
@admin_required
def list_backups():
    return jsonify(backup_svc.list_backups())


@bp.route("/backups", methods=["POST"])
@admin_required
@bp.arguments(s.BackupIn)
def create_backup(data):
    """Create a consistent, encrypted backup (SQLite online backup + attachments) on the server."""
    return ok(backup_svc.create_backup(include_attachments=data["include_attachments"]), 201)


@bp.route("/backups/download", methods=["POST"])
@admin_required
def download_fresh():
    """Create a backup and download it right away (POST: creating files is a state change)."""
    info = backup_svc.create_backup(include_attachments=True)
    return _send_backup(info["name"])


def _send_backup(name: str):
    path = backup_svc.backup_path(name)
    resp = send_file(path, mimetype="application/octet-stream", as_attachment=True, download_name=name, max_age=0)
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


@bp.route("/backups/<string:name>", methods=["GET"])
@admin_required
def download_backup(name: str):
    return _send_backup(name)


@bp.route("/backups/<string:name>", methods=["DELETE"])
@admin_required
def delete_backup(name: str):
    backup_svc.delete_backup(name)
    return ok()


# --------------------------------------------------------------------------- login log

@bp.route("/login-attempts", methods=["GET"])
@admin_required
@bp.arguments(s.LoginLogQuery, location="query")
def login_attempts(args):
    """Security log of all sign-in attempts. Filter by email (substring), success, date range."""
    from ..models import LoginAttempt
    from .auth_routes import serialize_attempt

    q = db.select(LoginAttempt)
    if args.get("email"):
        q = q.where(LoginAttempt.email.contains(args["email"].strip().lower()))
    if args.get("success") is not None:
        q = q.where(LoginAttempt.success.is_(args["success"]))
    if args.get("from_") and args.get("to"):
        a, b = range_bounds_utc(args["from_"], args["to"], "UTC")
        q = q.where(LoginAttempt.at >= a, LoginAttempt.at < b)
    total = db.session.scalar(db.select(db.func.count()).select_from(q.subquery()))
    rows = db.session.scalars(q.order_by(LoginAttempt.at.desc(), LoginAttempt.id.desc())
                              .limit(args["limit"]).offset(args["offset"]))
    failed_24h = db.session.scalar(db.select(db.func.count(LoginAttempt.id)).where(
        LoginAttempt.success.is_(False), LoginAttempt.reason != "reset_requested",
        LoginAttempt.at >= utcnow() - timedelta(hours=24))) or 0
    return jsonify({"total": total, "failed_last_24h": failed_24h, "items": [serialize_attempt(r) for r in rows]})


# --------------------------------------------------------------------------- api tokens

@bp.route("/api-tokens", methods=["GET"])
@admin_required
@bp.arguments(s.TokenListQuery, location="query")
def list_api_tokens(args):
    """All personal access tokens in the company with scopes, expiry and usage (audit overview)."""
    from ..models import ApiToken
    from .auth_routes import serialize_token

    q = db.select(ApiToken)
    if not args.get("include_inactive"):
        q = q.where(ApiToken.revoked_at.is_(None), db.or_(ApiToken.expires_at.is_(None), ApiToken.expires_at > utcnow()))
    rows = db.session.scalars(q.order_by(ApiToken.created_at.desc()))
    return jsonify([serialize_token(t, with_user=True) for t in rows])


@bp.route("/api-tokens/<int:token_id>", methods=["DELETE"])
@admin_required
@bp.arguments(s.TokenRevokeIn)
def admin_revoke_token(data, token_id: int):
    """Revoke any token (logged with the administrator and the reason; the owner is notified)."""
    from ..auth import revoke_token
    from ..models import ApiToken
    from ..services import notifications

    t = db.session.get(ApiToken, token_id)
    if t is None:
        raise NotFound("Token not found")
    if t.revoked_at is None:
        revoke_token(t, actor_id=me().id, reason=data.get("reason") or "Revoked by administrator")
        if t.user_id != me().id:
            notifications.notify(t.user, "token_revoked", actor_name=me().name, name=t.name, reason=data.get("reason") or "")
    db.session.commit()
    return ok()


# --------------------------------------------------------------------------- audit log

@bp.route("/audit", methods=["GET"])
@admin_required
@bp.arguments(s.AuditQuery, location="query")
def audit(args):
    """Browse the change log (all entities)."""
    q = db.select(Revision)
    if not me().is_hr:
        # Administrators without the HR capability see no time data, not even in the change log.
        q = q.where(Revision.entity.in_(ADMIN_AUDIT_ENTITIES))
    if args.get("user_id"):
        q = q.where(Revision.subject_user_id == args["user_id"])
    if args.get("entity"):
        q = q.where(Revision.entity == args["entity"])
    if args.get("from_") and args.get("to"):
        a, b = range_bounds_utc(args["from_"], args["to"], "UTC")
        q = q.where(Revision.at >= a, Revision.at < b)
    total = db.session.scalar(db.select(db.func.count()).select_from(q.subquery()))
    rows = db.session.scalars(q.order_by(Revision.at.desc(), Revision.id.desc())
                              .limit(args["limit"]).offset(args["offset"]))
    return jsonify({"total": total, "items": [revisions.serialize(r) for r in rows]})


# --------------------------------------------------------------------------- getting started

@bp.route("/getting-started", methods=["GET"])
@admin_required
def getting_started():
    """Setup checklist shown to administrators on the dashboard, with the live status of each step."""
    cfg = current_app.config
    default_cal = db.session.scalar(db.select(HolidayCalendar).where(HolidayCalendar.is_default.is_(True)))
    holidays_in_default = (db.session.scalar(db.select(db.func.count(Holiday.id))
                                             .where(Holiday.calendar_id == default_cal.id)) if default_cal else 0) or 0
    rules_saved = db.session.scalar(db.select(db.func.count(Setting.key)).where(
        Setting.key.in_(("fulltime_weekly_minutes", "holiday_mode", "weekly_max_minutes", "clock_reminder_hours")))) or 0
    teams = db.session.scalar(db.select(db.func.count(Team.id))) or 0
    from ..services import permissions as perm_svc

    hr_count = len(perm_svc.hr_users())
    leads_count = len({r.team_id for r in perm_svc.active_lead_rows()})
    employees = db.session.scalar(db.select(db.func.count(User.id)).where(
        User.role != "admin", User.is_active.is_(True))) or 0
    backups = backup_svc.list_backups()
    logos = branding.info()["logos"]
    steps = {
        "rules": {"done": rules_saved > 0, "href": "/admin/settings"},
        "email": {"done": bool(cfg["SMTP_HOST"]), "href": "/admin/settings"},
        "holidays": {"done": holidays_in_default > 0, "href": "/admin/holidays", "count": holidays_in_default},
        "teams": {"done": teams > 0 and leads_count > 0, "href": "/admin/teams", "count": teams},
        "roles": {"done": hr_count > 0, "href": "/admin/users", "count": hr_count},
        "employees": {"done": employees > 0, "href": "/admin/users", "count": employees},
        "branding": {"done": logos["dark"]["custom"] or logos["light"]["custom"], "href": "/admin/settings",
                     "optional": True},
        "backups": {"done": len(backups) > 0, "href": "/admin/backups", "optional": True,
                    "last_at": backups[0]["created_at"] if backups else None},
    }
    return jsonify({"dismissed": settings_svc.get("getting_started_dismissed"), "steps": steps})


@bp.route("/getting-started/dismiss", methods=["POST"])
@admin_required
def dismiss_getting_started():
    settings_svc.update({"getting_started_dismissed": True})
    db.session.commit()
    return ok()
