# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Auth, setup wizard, public meta, profile, sessions, API tokens, notifications."""

from __future__ import annotations

from datetime import timedelta

from flask import current_app, g, jsonify, make_response, request
from flask_smorest import Blueprint

from .. import __version__
from ..auth import (
    API_TOKEN_PREFIX,
    SCOPES,
    clear_session_cookies,
    client_ip,
    create_session,
    login_required,
    revoke_user_sessions,
    revoke_user_tokens,
    scope_required,
    set_session_cookies,
)
from ..errors import Conflict, Forbidden, NotFound, TooManyRequests, Unauthorized, Validation
from ..extensions import db
from ..models import ROLE_ADMIN, ApiToken, AuthToken, LoginAttempt, User, UserSession
from ..security import hash_password, needs_rehash, new_token, password_problems, token_hash, verify_password
from ..services import absences as absences_svc
from ..services import accounts, entries, holidays, mfa, notifications, presets
from ..services import settings as settings_svc
from ..services import users as users_svc
from ..services import worklog as worklog_svc
from ..timeutil import all_timezones, iso, local_today, utcnow
from . import schemas as s
from .common import me, ok

TOKEN_DEFAULT_DAYS = 90
TOKEN_MAX_DAYS = 365
TOKEN_MAX_ADMIN_DAYS = 90

bp = Blueprint("auth", __name__, url_prefix="/api/v1", description="Authentication, profile and tokens")

PASSWORD_MESSAGES = {
    "password.too_short": "Use at least 10 characters",
    "password.too_long": "Use at most 256 characters",
    "password.too_common": "This password is too easy to guess",
    "password.contains_email": "The password must not contain your email name",
    "password.breached": "This password appears in known data breaches; please choose another one",
}


def _check_password(password: str, user_email: str = "", name: str = "") -> None:
    problems = password_problems(password, user_email, name, online=bool(current_app.config["PWNED_PASSWORDS_CHECK"]))
    if problems:
        raise Validation(PASSWORD_MESSAGES[problems[0]], code="weak_password",
                         fields={"password": problems[0]})


# --------------------------------------------------------------------------- meta / setup

@bp.route("/meta", methods=["GET"])
def meta():
    """Public information for the login page and app shell."""
    st = settings_svc.get_all()
    setup_required = not st["setup_complete"] and \
        db.session.scalar(db.select(db.func.count(User.id))) == 0
    cfg = current_app.config
    return jsonify({"company_name": st["company_name"],
                    "default_timezone": st["default_timezone"], "default_locale": st["default_locale"],
                    "setup_required": setup_required, "setup_code_required": bool(cfg["SETUP_CODE_REQUIRED"]),
                    "smtp_configured": bool(cfg["SMTP_HOST"]), "source_url": cfg.get("SOURCE_URL") or None})


@bp.route("/meta/holiday-presets", methods=["GET"])
def holiday_presets():
    return jsonify(presets.preset_list())


@bp.route("/meta/timezones", methods=["GET"])
def timezones():
    return jsonify(all_timezones())


@bp.route("/setup", methods=["POST"])
@bp.arguments(s.SetupIn)
def setup(data):
    """First-run wizard: creates the first administrator and company settings."""
    if db.session.scalar(db.select(db.func.count(User.id))) > 0 or settings_svc.get("setup_complete"):
        raise Conflict("Setup has already been completed", code="setup_done")
    if current_app.config["SETUP_CODE_REQUIRED"]:
        from ..services import setup_code

        code = (data.get("setup_code") or request.headers.get("X-Setup-Code") or "").strip()
        if _throttled("setup") or not setup_code.verify(code):
            record_login("setup", None, False, "setup_code")
            db.session.commit()
            raise Forbidden("The setup code is missing or wrong. It is printed in the server log "
                            "(`docker compose logs app`) or shown by `flask resorixtrack setup-code`.",
                            code="setup_code_invalid")
    _check_password(data["admin_password"], data["admin_email"])
    changes = {"company_name": data["company_name"].strip(), "default_locale": data["locale"],
               "default_timezone": data["timezone"], "setup_complete": True}
    if data.get("fulltime_weekly_minutes"):
        changes["fulltime_weekly_minutes"] = int(data["fulltime_weekly_minutes"])
    if data.get("default_vacation_days") is not None:
        changes["default_vacation_days"] = float(data["default_vacation_days"])
    settings_svc.update(changes)
    absences_svc.seed_types()
    if data.get("holiday_preset"):
        if data["holiday_preset"] not in presets.PRESETS:
            raise Validation("Unknown holiday preset", fields={"holiday_preset": "invalid"})
        presets.install_preset(data["holiday_preset"], make_default=True)
    elif data.get("holiday_country"):
        cal = holidays.save_calendar({"name": f"Public holidays {data['holiday_country']}"
                                      + (f"-{data['holiday_subdiv']}" if data.get("holiday_subdiv") else ""),
                                      "is_default": True})
        year = local_today(data["timezone"]).year
        for y in (year, year + 1):
            holidays.import_holidays(cal, data["holiday_country"], data.get("holiday_subdiv"), y,
                                     include_half_days=True)
    admin = users_svc.create_user(None, {"email": data["admin_email"], "name": data["admin_name"],
                                         "role": ROLE_ADMIN, "timezone": data["timezone"],
                                         "locale": data["locale"], "employment_start": data.get("employment_start"),
                                         # The founding administrator starts with every capability; hand them on later.
                                         "capabilities": ["hr", "projects"]},
                                  password=data["admin_password"], send_invite=False)
    if current_app.config["SETUP_CODE_REQUIRED"]:
        from ..services import setup_code

        setup_code.clear()
    sess, raw = create_session(admin, remember=True)
    admin.last_login_at = utcnow()
    record_login(admin.email, admin, True, "setup")
    db.session.commit()
    resp = make_response(jsonify({"user": users_svc.serialize_user(admin), "csrf_token": sess.csrf_token}), 201)
    set_session_cookies(resp, sess, raw)
    return resp


# --------------------------------------------------------------------------- login / logout

def mask_email(email: str) -> str:
    """`anna.meier@example.com` -> `an***@example.com`; unknown addresses are stored masked because
    people regularly type their password into the email field."""
    local, _, domain = (email or "").partition("@")
    return f"{local[:2]}***@{domain}" if domain else f"{local[:2]}***"


_NOT_COUNTED = ("throttled", "reset_requested", "setup_code")


def record_login(email: str, user: User | None, success: bool, reason: str) -> None:
    """Security log of sign-in attempts (kept for `login_log_retention_days`)."""
    from flask import request

    stored = email if (user is not None or reason in ("throttled", "reset_requested")) else mask_email(email)
    db.session.add(LoginAttempt(email=stored[:254], user_id=user.id if user else None, ip=client_ip(),
                                user_agent=(request.headers.get("User-Agent") or "")[:300], success=success,
                                reason=reason))
    log = current_app.logger.info if success else current_app.logger.warning
    log("auth: login %s for %s (user=%s, ip=%s, reason=%s)", "success" if success else "failure",
        email if user is not None else mask_email(email), user.id if user else "-", client_ip(), reason)


def _failures(since, *conds) -> int:
    return db.session.scalar(db.select(db.func.count(LoginAttempt.id)).where(
        LoginAttempt.success.is_(False), LoginAttempt.reason.not_in(_NOT_COUNTED), LoginAttempt.at >= since,
        *conds)) or 0


def _throttled(email: str) -> bool:
    """Hard block per (email, IP) after LOGIN_MAX_FAILURES; wider ceilings per email (x5, protects an
    account against a distributed spray) and per IP (x4) in the same window."""
    cfg = current_app.config
    since = utcnow() - timedelta(minutes=cfg["LOGIN_WINDOW_MINUTES"])
    limit = cfg["LOGIN_MAX_FAILURES"]
    ip = client_ip()
    return (_failures(since, LoginAttempt.email == email, LoginAttempt.ip == ip) >= limit
            or _failures(since, LoginAttempt.email == email) >= limit * 5
            or _failures(since, LoginAttempt.ip == ip) >= limit * 4)


def _record_throttled(email: str, user: User | None) -> None:
    """One log row per (email, IP) and window, so a flood of blocked requests can't fill the table."""
    since = utcnow() - timedelta(minutes=current_app.config["LOGIN_WINDOW_MINUTES"])
    last = db.session.scalars(db.select(LoginAttempt).where(
        LoginAttempt.email == email, LoginAttempt.ip == client_ip(), LoginAttempt.at >= since)
        .order_by(LoginAttempt.at.desc(), LoginAttempt.id.desc()).limit(1)).first()
    if last is None or last.reason != "throttled":
        record_login(email, user, False, "throttled")
        db.session.commit()


def _reset_throttled(email: str) -> bool:
    """Password-reset mails: at most 3 per address and 20 per IP within an hour."""
    since = utcnow() - timedelta(hours=1)
    base = db.select(db.func.count(LoginAttempt.id)).where(LoginAttempt.reason == "reset_requested",
                                                            LoginAttempt.at >= since)
    by_email = db.session.scalar(base.where(LoginAttempt.email == email)) or 0
    by_ip = db.session.scalar(base.where(LoginAttempt.ip == client_ip())) or 0
    return by_email >= 3 or by_ip >= 20


@bp.route("/auth/login", methods=["POST"])
@bp.arguments(s.LoginIn)
def login(data):
    """Sign in. `remember=true` keeps the session for 30 days (sliding)."""
    email = (data["email"] or "").strip().lower()
    user = db.session.scalar(db.select(User).where(User.email == email))
    if _throttled(email):
        _record_throttled(email, user)
        raise TooManyRequests("Too many failed attempts. Please wait a few minutes and try again.")
    valid = verify_password(user.password_hash if user else None, data["password"])
    if not valid or user is None or not user.is_active:
        reason = "unknown_user" if user is None else ("invalid_password" if not valid else "inactive")
        record_login(email, user, False, reason)
        db.session.commit()
        raise Unauthorized("Email or password is incorrect", code="invalid_credentials")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(data["password"])
    if mfa.is_enabled(user):
        # Password accepted; the session is only created after the second factor (POST /auth/mfa).
        raw_mfa = users_svc.issue_mfa_token(user)
        db.session.commit()
        return jsonify({"mfa_required": True, "mfa_token": raw_mfa})
    return _finish_login(user, remember=bool(data.get("remember", True)))


def _finish_login(user: User, remember: bool):
    record_login(user.email, user, True, "ok")
    sess, raw = create_session(user, remember=remember)
    user.last_login_at = utcnow()
    db.session.commit()
    resp = make_response(jsonify({"user": users_svc.serialize_user(user), "csrf_token": sess.csrf_token}))
    set_session_cookies(resp, sess, raw)
    return resp


@bp.route("/auth/mfa", methods=["POST"])
@bp.arguments(s.MfaLoginIn)
def login_mfa(data):
    """Second sign-in step: the 6-digit authenticator code or a recovery code."""
    tok = db.session.scalar(db.select(AuthToken).where(AuthToken.token_hash == token_hash(data["mfa_token"])))
    if tok is None or tok.purpose != "mfa" or tok.used_at is not None or tok.expires_at <= utcnow():
        raise Unauthorized("The sign-in attempt has expired; please sign in again", code="mfa_expired")
    user = tok.user
    if _throttled(user.email):
        _record_throttled(user.email, user)
        raise TooManyRequests("Too many failed attempts. Please wait a few minutes and try again.")
    if not user.is_active or not mfa.verify_code(user, data["code"]):
        record_login(user.email, user, False, "invalid_mfa")
        db.session.commit()
        raise Unauthorized("The code is not valid", code="invalid_mfa")
    tok.used_at = utcnow()
    return _finish_login(user, remember=bool(data.get("remember", True)))


# --------------------------------------------------------------------------- two-factor (profile)

@bp.route("/auth/mfa", methods=["GET"])
@login_required
def mfa_status():
    return jsonify(mfa.status(me()))


@bp.route("/auth/mfa/setup", methods=["POST"])
@bp.arguments(s.MfaPasswordIn)
@login_required
def mfa_setup(data):
    """Start enabling 2FA: returns the secret, the otpauth URI and a QR code (SVG)."""
    result = mfa.begin_setup(me(), data["current_password"])
    db.session.commit()
    return jsonify(result)


@bp.route("/auth/mfa/confirm", methods=["POST"])
@bp.arguments(s.MfaCodeIn)
@login_required
def mfa_confirm(data):
    """Finish enabling 2FA with a code from the app; returns the recovery codes (shown once)."""
    codes = mfa.confirm_setup(me(), data["code"])
    _log_mfa(me(), "mfa_enabled")
    db.session.commit()
    return jsonify({"recovery_codes": codes})


@bp.route("/auth/mfa/recovery-codes", methods=["POST"])
@bp.arguments(s.MfaPasswordCodeIn)
@login_required
def mfa_recovery_codes(data):
    codes = mfa.regenerate_recovery_codes(me(), data["current_password"], data["code"])
    db.session.commit()
    return jsonify({"recovery_codes": codes})


@bp.route("/auth/mfa/disable", methods=["POST"])
@bp.arguments(s.MfaPasswordCodeIn)
@login_required
def mfa_disable(data):
    mfa.disable(me(), data["current_password"], data["code"])
    _log_mfa(me(), "mfa_disabled")
    db.session.commit()
    return ok()


def _log_mfa(user: User, action: str, actor: User | None = None) -> None:
    from ..models import Revision

    db.session.add(Revision(entity="user", entity_id=user.id, subject_user_id=user.id,
                            actor_id=(actor or user).id, action=action, before=None, after=None,
                            reason="", source="web"))


@bp.route("/auth/logout", methods=["POST"])
def logout():
    sess = g.get("session")
    if sess is not None:
        sess.revoked_at = utcnow()
        db.session.commit()
    resp = make_response(jsonify({"ok": True}))
    clear_session_cookies(resp)
    return resp


@bp.route("/auth/forgot", methods=["POST"])
@bp.arguments(s.EmailIn)
def forgot(data):
    """Always answers 200 so the endpoint can't be used to discover accounts."""
    email = (data["email"] or "").strip().lower()
    if _throttled(email) or _reset_throttled(email):
        raise TooManyRequests("Too many attempts. Please wait a few minutes and try again.")
    user = db.session.scalar(db.select(User).where(User.email == email))
    record_login(email, user, False, "reset_requested")  # has its own limit, never locks the account
    if user is not None and user.is_active:
        if user.password_hash is None:
            users_svc.send_invite_mail(user, None)
        else:
            users_svc.send_reset_mail(user)
    db.session.commit()
    return ok()


@bp.route("/auth/token-info", methods=["POST"])
@bp.arguments(s.TokenQuery)
def token_info(args):
    """Describe an invitation / reset link. POST so the token never appears in access logs."""
    tok = users_svc.consume_token(args["token"], ("invite", "reset"))
    return jsonify({"purpose": tok.purpose, "email": tok.user.email, "name": tok.user.name,
                    "expires_at": iso(tok.expires_at)})


def _set_password_with_token(data, purposes: tuple[str, ...]):
    tok = users_svc.consume_token(data["token"], purposes)
    user = tok.user
    if not user.is_active:
        raise Validation("This account is disabled", code="invalid_token")
    _check_password(data["password"], user.email, user.name)
    if data.get("locale"):
        user.locale = data["locale"]
    if data.get("timezone"):
        from ..timeutil import is_valid_tz

        if not is_valid_tz(data["timezone"]):
            raise Validation("Unknown timezone", fields={"timezone": "invalid"})
        user.timezone = data["timezone"]
    user.password_hash = hash_password(data["password"])
    user.password_changed_at = utcnow()
    tok.used_at = utcnow()
    users_svc.invalidate_links(user)
    revoke_user_sessions(user.id)
    revoke_user_tokens(user.id)
    sess, raw = create_session(user, remember=True)
    user.last_login_at = utcnow()
    record_login(user.email, user, True, tok.purpose)
    if tok.purpose == "reset":
        from ..services import mail

        mail.send(mail.build("password_changed", user.email, user.locale, user=user))
    db.session.commit()
    resp = make_response(jsonify({"user": users_svc.serialize_user(user), "csrf_token": sess.csrf_token}))
    set_session_cookies(resp, sess, raw)
    return resp


@bp.route("/auth/reset", methods=["POST"])
@bp.arguments(s.TokenPasswordIn)
def reset(data):
    return _set_password_with_token(data, ("reset", "invite"))


@bp.route("/auth/accept-invite", methods=["POST"])
@bp.arguments(s.TokenPasswordIn)
def accept_invite(data):
    return _set_password_with_token(data, ("invite",))


@bp.route("/auth/change-password", methods=["POST"])
@bp.arguments(s.ChangePasswordIn)
@login_required
def change_password(data):
    user = me()
    if not verify_password(user.password_hash, data["current_password"]):
        raise Validation("Current password is incorrect", fields={"current_password": "invalid"})
    _check_password(data["new_password"], user.email, user.name)
    user.password_hash = hash_password(data["new_password"])
    user.password_changed_at = utcnow()
    current = g.get("session")
    users_svc.invalidate_links(user)
    revoke_user_sessions(user.id, except_id=current.id if current else None)
    revoke_user_tokens(user.id)
    from ..services import mail

    mail.send(mail.build("password_changed", user.email, user.locale, user=user))
    db.session.commit()
    return ok()


# --------------------------------------------------------------------------- sessions

def _describe_agent(ua: str) -> str:
    ua_l = ua.lower()
    browser = next((n for k, n in (("edg/", "Edge"), ("firefox", "Firefox"), ("chrome", "Chrome"),
                                   ("safari", "Safari"), ("curl", "curl")) if k in ua_l), "Browser")
    osname = next((n for k, n in (("iphone", "iOS"), ("ipad", "iPadOS"), ("android", "Android"),
                                  ("windows", "Windows"), ("mac os", "macOS"), ("linux", "Linux")) if k in ua_l), "")
    return f"{browser} on {osname}" if osname else browser


def serialize_attempt(a: LoginAttempt) -> dict:
    return {"id": a.id, "email": a.email, "user_id": a.user_id, "user_name": a.user.name if a.user else None,
            "ip": a.ip, "device": _describe_agent(a.user_agent), "user_agent": a.user_agent, "success": a.success,
            "reason": a.reason, "at": iso(a.at)}


@bp.route("/auth/login-history", methods=["GET"])
@login_required
def login_history():
    """The signed-in user's recent sign-in attempts (successful and failed)."""
    rows = db.session.scalars(db.select(LoginAttempt).where(
        db.or_(LoginAttempt.user_id == me().id, LoginAttempt.email == me().email),
        LoginAttempt.reason != "reset_requested").order_by(LoginAttempt.at.desc(), LoginAttempt.id.desc()).limit(50))
    return jsonify([serialize_attempt(a) for a in rows])


@bp.route("/auth/sessions", methods=["GET"])
@login_required
def sessions():
    current = g.get("session")
    rows = db.session.scalars(db.select(UserSession).where(
        UserSession.user_id == me().id, UserSession.revoked_at.is_(None),
        UserSession.expires_at > utcnow()).order_by(UserSession.last_seen_at.desc()))
    return jsonify([{"id": r.id, "device": _describe_agent(r.user_agent), "user_agent": r.user_agent,
                     "ip": r.ip, "remember": r.remember, "created_at": iso(r.created_at),
                     "last_seen_at": iso(r.last_seen_at), "expires_at": iso(r.expires_at),
                     "current": current is not None and r.id == current.id} for r in rows])


@bp.route("/auth/sessions/<int:session_id>", methods=["DELETE"])
@login_required
def revoke_session(session_id: int):
    r = db.session.get(UserSession, session_id)
    if r is None or r.user_id != me().id:
        raise NotFound("Session not found")
    r.revoked_at = utcnow()
    db.session.commit()
    return ok()


@bp.route("/auth/sessions/revoke-others", methods=["POST"])
@login_required
def revoke_others():
    current = g.get("session")
    n = revoke_user_sessions(me().id, except_id=current.id if current else None)
    db.session.commit()
    return ok({"revoked": n})


# --------------------------------------------------------------------------- me

def _me_payload(user):
    sess = g.get("session")
    return {
        "user": users_svc.serialize_user(user, detail=True),
        "csrf_token": sess.csrf_token if sess else None,
        "permissions": {
            "admin": user.is_admin, "lead": user.is_lead, "hr": user.is_hr, "projects": user.has_cap("projects"),
            "manager": user.is_hr or user.is_lead,
            "lead_can_edit_schedules": bool(settings_svc.get("lead_can_edit_schedules")),
            "lead_can_adjust_balances": bool(settings_svc.get("lead_can_adjust_balances")),
        },
        "unread_notifications": notifications.unread_count(user),
        "company_name": settings_svc.get("company_name"),
        "auth_method": g.get("auth_method"),
        "version": __version__ if user.is_admin else None,
        "smtp_configured": bool(current_app.config["SMTP_HOST"]) if user.is_admin else None,
        "weekly_max_minutes": int(settings_svc.get("weekly_max_minutes")),
        "session_remember_days": int(settings_svc.get("session_remember_days")),
        "mfa_enabled": mfa.is_enabled(user),
        "api_tokens_enabled": bool(settings_svc.get("api_tokens_enabled")),
        "worklog": worklog_svc.config(),
        "mfa_required_for_admins": bool(settings_svc.get("mfa_required_for_admins")),
        "mfa_required": mfa.required_for(user),
        "fulltime_weekly_minutes": int(settings_svc.get("fulltime_weekly_minutes")),
    }


@bp.route("/me", methods=["GET"])
@scope_required()
def get_me():
    return jsonify(_me_payload(me()))


@bp.route("/me", methods=["PATCH"])
@bp.arguments(s.ProfileIn)
@login_required
def patch_me(data):
    users_svc.update_profile(me(), data)
    db.session.commit()
    return jsonify(_me_payload(me()))


@bp.route("/me/export", methods=["GET"])
@login_required
def export_me():
    """Everything RESORIXtrack stores about you, as a JSON file (session only)."""
    from ..services import privacy
    from .common import file_response

    return file_response(privacy.export_user_json(me()), "application/json", "resorixtrack-my-data.json")


@bp.route("/me/summary", methods=["GET"])
@scope_required()
def summary():
    """Dashboard tiles: today, this week, balance, vacation, sick-report availability."""
    user = me()
    today = local_today(user.timezone)
    week_start = today - timedelta(days=today.weekday())
    ctx = accounts.load_context(user, week_start, week_start + timedelta(days=6))
    days = accounts.compute_days(ctx)
    today_d = next(d for d in days if d.date == today.isoformat())
    week = accounts.summarize(days)
    vac = accounts.vacation_account(user, today.year)
    upcoming = absences_svc.list_for_users([user.id], today, today + timedelta(days=90),
                                           statuses=("approved", "pending"))
    return jsonify({
        "today": today_d.as_dict(), "week": week, "week_days": [d.as_dict() for d in days],
        "balance": accounts.time_balance(user), "vacation": vac,
        "clock": entries.clock_state(user),
        "sick_report": absences_svc.self_sick_allowed(user),
        "pending_approvals": len(absences_svc.pending_for_approver(user)),
        "upcoming_absences": [absences_svc.serialize(a, user) for a in upcoming[:5]],
    })


# --------------------------------------------------------------------------- tokens

@bp.route("/tokens", methods=["GET"])
@login_required
def list_tokens():
    rows = db.session.scalars(db.select(ApiToken).where(ApiToken.user_id == me().id, ApiToken.revoked_at.is_(None))
                              .order_by(ApiToken.created_at.desc()))
    return jsonify([serialize_token(t) for t in rows])


def serialize_token(t: ApiToken, with_user: bool = False) -> dict:
    now = utcnow()
    status = "revoked" if t.revoked_at else "expired" if (t.expires_at and t.expires_at <= now) else "active"
    data = {"id": t.id, "name": t.name, "prefix": t.prefix, "scopes": t.scopes.split(),
            "last_used_at": iso(t.last_used_at), "last_used_ip": t.last_used_ip, "use_count": t.use_count or 0,
            "expires_at": iso(t.expires_at), "created_at": iso(t.created_at), "created_ip": t.created_ip,
            "revoked_at": iso(t.revoked_at), "status": status}
    if with_user:
        data["user"] = {"id": t.user.id, "name": t.user.name, "email": t.user.email}
        data["revoked_by"] = {"id": t.revoked_by_id} if t.revoked_by_id else None
    return data


@bp.route("/tokens", methods=["POST"])
@bp.arguments(s.TokenIn)
@login_required
def create_token(data):
    """Create a personal access token. The secret is only shown once."""
    if g.get("token") is not None:
        raise Validation("API tokens cannot create other tokens; use the web app")
    if not settings_svc.get("api_tokens_enabled"):
        raise Conflict("Personal API tokens are disabled by your administrator", code="tokens_disabled")
    scopes = sorted(set(data["scopes"]))
    if "admin" in scopes and not me().is_admin:
        raise Validation("Only administrators can create admin tokens", fields={"scopes": "admin"})
    if not verify_password(me().password_hash, data.get("current_password") or ""):
        raise Validation("Current password is incorrect", fields={"current_password": "invalid"})
    t, raw = _issue_token(me(), data["name"], scopes, data.get("expires_in_days"), source="web")
    db.session.commit()
    return ok({"id": t.id, "name": t.name, "token": raw, "scopes": scopes, "expires_at": iso(t.expires_at)}, 201)


def _issue_token(user: User, name: str, scopes: list[str], expires_in_days: int | None, source: str) -> tuple[ApiToken, str]:
    """Creates a personal access token for `user` and writes the audit entry; the caller commits."""
    from ..auth import token_audit_data
    from ..models import Revision

    days = int(expires_in_days or TOKEN_DEFAULT_DAYS)
    days = min(days, TOKEN_MAX_ADMIN_DAYS if "admin" in scopes else TOKEN_MAX_DAYS)
    raw = API_TOKEN_PREFIX + new_token(32)
    t = ApiToken(user_id=user.id, name=name.strip(), prefix=raw[:10], token_hash=token_hash(raw),
                 scopes=" ".join(scopes), expires_at=utcnow() + timedelta(days=days), created_ip=client_ip())
    db.session.add(t)
    db.session.flush()
    db.session.add(Revision(entity="api_token", entity_id=t.id, subject_user_id=user.id, actor_id=user.id,
                            action="create", before=None, after=token_audit_data(t), reason="", source=source))
    return t, raw


@bp.route("/auth/token", methods=["POST"])
@bp.arguments(s.AppTokenIn)
def app_token(data):
    """Sign in from a desktop or mobile app and receive a personal access token in one step.

    Email + password, plus the authenticator or recovery code when two-factor authentication is enabled
    (the answer `mfa_required` tells the app to ask for it). Same throttling and sign-in log as the web
    sign-in; the token is audited like one created in the web app. The secret is only shown once.
    """
    email = (data["email"] or "").strip().lower()
    user = db.session.scalar(db.select(User).where(User.email == email))
    if _throttled(email):
        _record_throttled(email, user)
        raise TooManyRequests("Too many failed attempts. Please wait a few minutes and try again.")
    valid = verify_password(user.password_hash if user else None, data["password"])
    if not valid or user is None or not user.is_active:
        reason = "unknown_user" if user is None else ("invalid_password" if not valid else "inactive")
        record_login(email, user, False, reason)
        db.session.commit()
        raise Unauthorized("Email or password is incorrect", code="invalid_credentials")
    if mfa.is_enabled(user):
        code = (data.get("code") or "").strip()
        if not code:
            raise Unauthorized("Two-factor authentication is enabled: send the authenticator code as `code`",
                               code="mfa_required")
        if not mfa.verify_code(user, code):
            record_login(email, user, False, "invalid_mfa")
            db.session.commit()
            raise Unauthorized("The code is not valid", code="invalid_mfa")
    if not settings_svc.get("api_tokens_enabled"):
        raise Conflict("Personal API tokens are disabled by your administrator", code="tokens_disabled")
    scopes = sorted(set(data["scopes"]))
    if "admin" in scopes and not user.is_admin:
        raise Validation("Only administrators can create admin tokens", fields={"scopes": "admin"})
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(data["password"])
    t, raw = _issue_token(user, data["name"], scopes, data.get("expires_in_days"), source="app")
    record_login(email, user, True, "token_issued")
    user.last_login_at = utcnow()
    db.session.commit()
    return ok({"id": t.id, "name": t.name, "token": raw, "scopes": scopes, "expires_at": iso(t.expires_at),
               "user": users_svc.serialize_user(user)}, 201)


@bp.route("/tokens/<int:token_id>", methods=["DELETE"])
@login_required
def delete_token(token_id: int):
    t = db.session.get(ApiToken, token_id)
    if t is None or t.user_id != me().id:
        raise NotFound("Token not found")
    if t.revoked_at is None:
        from ..auth import revoke_token

        revoke_token(t, actor_id=me().id, reason="Revoked by the owner")
    db.session.commit()
    return ok()


@bp.route("/tokens/scopes", methods=["GET"])
def token_scopes():
    return jsonify(list(SCOPES))


# --------------------------------------------------------------------------- notifications

@bp.route("/notifications", methods=["GET"])
@scope_required()
def list_notifications():
    items = notifications.list_for(me())
    return jsonify({"items": [notifications.serialize(n) for n in items],
                    "unread": notifications.unread_count(me())})


@bp.route("/notifications/read", methods=["POST"])
@bp.arguments(s.ReadIn)
@login_required
def read_notifications(data):
    n = notifications.mark_read(me(), data.get("ids"))
    db.session.commit()
    return ok({"marked": n})
