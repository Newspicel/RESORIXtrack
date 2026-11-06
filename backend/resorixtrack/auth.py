# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Authentication: server-side sessions (web) and personal access tokens (API)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from functools import wraps
from typing import Any

from flask import Flask, Response, current_app, g, request

from .errors import Forbidden, Unauthorized
from .extensions import db
from .models import ApiToken, User, UserSession
from .security import constant_time_equals, new_token, token_hash
from .services import settings as settings_svc
from .timeutil import utcnow

API_TOKEN_PREFIX = "rt_"  # noqa: S105 - token prefix, not a secret
SCOPES = ("clock", "entries:read", "entries:write", "absences:read", "absences:write",
          "reports:read", "admin")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Only touch last_seen/expiry at most every N minutes to keep SQLite writes low.
_SLIDE_EVERY = timedelta(minutes=5)


def current_user() -> User | None:
    return g.get("user")


def client_ip() -> str:
    return (request.remote_addr or "")[:64]


# --------------------------------------------------------------------------- sessions

def _session_lifetime(remember: bool) -> timedelta:
    if remember:
        return timedelta(days=int(settings_svc.get("session_remember_days")))
    return timedelta(hours=current_app.config["SESSION_SHORT_IDLE_HOURS"])


def _absolute_expiry(sess: UserSession):
    return sess.created_at + timedelta(days=int(current_app.config["SESSION_ABSOLUTE_DAYS"]))


def create_session(user: User, remember: bool) -> tuple[UserSession, str]:
    raw = new_token(32)
    now = utcnow()
    sess = UserSession(
        user_id=user.id, token_hash=token_hash(raw), csrf_token=new_token(24), remember=remember,
        user_agent=(request.headers.get("User-Agent") or "")[:300], ip=client_ip(),
        created_at=now, last_seen_at=now, expires_at=now + _session_lifetime(remember),
    )
    sess.expires_at = min(sess.expires_at, _absolute_expiry(sess))
    db.session.add(sess)
    db.session.flush()
    return sess, raw


def set_session_cookies(response: Response, sess: UserSession, raw_token: str) -> None:
    cfg = current_app.config
    max_age = int((sess.expires_at - utcnow()).total_seconds()) if sess.remember else None
    response.set_cookie(cfg["SESSION_COOKIE_NAME"], raw_token, max_age=max_age, httponly=True,
                        secure=cfg["SESSION_COOKIE_SECURE"], samesite="Lax", path="/")
    response.set_cookie(cfg["CSRF_COOKIE_NAME"], sess.csrf_token, max_age=max_age, httponly=False,
                        secure=cfg["SESSION_COOKIE_SECURE"], samesite="Lax", path="/")


def clear_session_cookies(response: Response) -> None:
    cfg = current_app.config
    response.delete_cookie(cfg["SESSION_COOKIE_NAME"], path="/")
    response.delete_cookie(cfg["CSRF_COOKIE_NAME"], path="/")


def revoke_user_sessions(user_id: int, except_id: int | None = None) -> int:
    now = utcnow()
    q = db.select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    count = 0
    for s in db.session.scalars(q):
        if s.id != except_id:
            s.revoked_at = now
            count += 1
    return count


def revoke_user_tokens(user_id: int, actor_id: int | None = None,
                       reason: str = "Revoked automatically: password or account change") -> int:
    """Revoke every personal access token of a user (after password reset, deactivation, ...). Audited."""
    now = utcnow()
    count = 0
    for t in db.session.scalars(db.select(ApiToken).where(ApiToken.user_id == user_id, ApiToken.revoked_at.is_(None))):
        revoke_token(t, actor_id=actor_id, reason=reason, now=now)
        count += 1
    return count


def revoke_token(t: ApiToken, actor_id: int | None, reason: str, now=None) -> None:
    from .models import Revision

    t.revoked_at = now or utcnow()
    t.revoked_by_id = actor_id
    db.session.add(Revision(entity="api_token", entity_id=t.id, subject_user_id=t.user_id, actor_id=actor_id,
                            action="revoke", before=token_audit_data(t), after=None, reason=(reason or "")[:500],
                            source="web"))


def token_audit_data(t: ApiToken) -> dict[str, Any]:
    return {"name": t.name, "prefix": t.prefix, "scopes": t.scopes.split(),
            "expires_at": t.expires_at.isoformat() + "Z" if t.expires_at else None}


def _load_from_session_cookie() -> None:
    raw = request.cookies.get(current_app.config["SESSION_COOKIE_NAME"])
    if not raw:
        return
    sess = db.session.scalar(db.select(UserSession).where(UserSession.token_hash == token_hash(raw)))
    now = utcnow()
    if sess is None or sess.revoked_at is not None or sess.expires_at <= now:
        g.clear_cookies = True
        return
    user = db.session.get(User, sess.user_id)
    if user is None or not user.is_active:
        g.clear_cookies = True
        return
    if now - sess.last_seen_at >= _SLIDE_EVERY:
        sess.last_seen_at = now
        sess.expires_at = min(now + _session_lifetime(sess.remember), _absolute_expiry(sess))
        db.session.commit()
        g.refresh_cookie = (sess, raw)
    g.user = user
    g.session = sess
    g.auth_method = "session"


def _load_from_bearer(header: str) -> None:
    raw = header[7:].strip()
    if not raw.startswith(API_TOKEN_PREFIX):
        raise Unauthorized("Invalid API token")
    tok = db.session.scalar(db.select(ApiToken).where(ApiToken.token_hash == token_hash(raw)))
    now = utcnow()
    if tok is None or tok.revoked_at is not None or (tok.expires_at and tok.expires_at <= now):
        raise Unauthorized("Invalid or expired API token")
    user = db.session.get(User, tok.user_id)
    if user is None or not user.is_active:
        raise Unauthorized("Account disabled")
    if not settings_svc.get("api_tokens_enabled"):
        raise Unauthorized("Personal API tokens are disabled by your administrator", code="tokens_disabled")
    # Usage audit: counter and last-used IP on the token; one sign-in-log row per token, day and IP.
    ip = client_ip()
    first_today = tok.last_used_at is None or tok.last_used_at.date() != now.date()
    if first_today or tok.last_used_ip != ip:
        from .models import LoginAttempt

        ua = (request.headers.get("User-Agent") or "")[:200]
        client = (request.headers.get("X-Client") or "")[:40]
        db.session.add(LoginAttempt(email=user.email, user_id=user.id, ip=ip, success=True, reason="api_token",
                                    user_agent=f'API token "{tok.name}"' + (f" · {client}" if client else "") + (f" · {ua}" if ua else "")))
    tok.use_count = (tok.use_count or 0) + 1
    tok.last_used_at = now
    tok.last_used_ip = ip
    db.session.commit()
    g.user = user
    g.token = tok
    g.auth_method = "token"


def _before_request() -> None:
    g.user = None
    g.session = None
    g.token = None
    g.auth_method = None
    g.clear_cookies = False
    g.refresh_cookie = None
    g.mail_queue = []
    if not request.path.startswith("/api/"):
        return
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        _load_from_bearer(header)
    else:
        _load_from_session_cookie()
        # CSRF: cookie-authenticated mutating requests must echo the CSRF token in a header.
        if g.session is not None and request.method not in SAFE_METHODS:
            sent = request.headers.get("X-CSRF-Token", "")
            if not sent or not constant_time_equals(sent, g.session.csrf_token):
                raise Forbidden("CSRF token missing or invalid", code="csrf_failed")


def _after_request(response: Response) -> Response:
    if g.get("clear_cookies") and not g.get("user"):
        clear_session_cookies(response)
    refresh = g.get("refresh_cookie")
    if refresh and g.get("session") is not None and g.session.revoked_at is None:
        set_session_cookies(response, *refresh)
    return response


def init_auth(app: Flask) -> None:
    app.before_request(_before_request)
    app.after_request(_after_request)


# --------------------------------------------------------------------------- decorators

def token_scopes() -> set[str]:
    tok: ApiToken | None = g.get("token")
    if tok is None:
        return set(SCOPES)  # interactive sessions have all scopes the role allows
    return {s for s in tok.scopes.split() if s}


def login_required(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Require a signed-in *browser session*. API tokens are rejected: routes that desktop clients
    may call declare their scopes explicitly with :func:`scope_required`."""

    @wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        if g.get("user") is None:
            raise Unauthorized("Authentication required")
        if g.get("token") is not None:
            raise Forbidden("This action is not available to API tokens; use the web app",
                            code="insufficient_scope")
        return fn(*args, **kwargs)

    return wrapper


def scope_required(*scopes: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Require login and (for API tokens) at least one of the given scopes. With no scopes, any
    valid token may call the route."""

    def deco(fn: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            if g.get("user") is None:
                raise Unauthorized("Authentication required")
            if scopes and not (token_scopes() & set(scopes)):
                raise Forbidden(f"API token lacks scope: {' or '.join(scopes)}", code="insufficient_scope")
            return fn(*args, **kwargs)

        return wrapper

    return deco


def admin_required(fn: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        user = g.get("user")
        if user is None:
            raise Unauthorized("Authentication required")
        if not user.is_admin:
            raise Forbidden("Administrator role required")
        if g.get("token") is not None and "admin" not in token_scopes():
            raise Forbidden("API token lacks scope: admin", code="insufficient_scope")
        return fn(*args, **kwargs)

    return wrapper


def request_source() -> str:
    if g.get("token") is not None:
        client = (request.headers.get("X-Client") or "").lower()
        return "desktop" if client.startswith("desktop") else "api"
    return "web"
