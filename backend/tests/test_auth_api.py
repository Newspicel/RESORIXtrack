# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
from __future__ import annotations

from datetime import timedelta

from conftest import DEFAULT_NOW, PASSWORD, extract_link, make_user, token_from

from resorixtrack.extensions import db
from resorixtrack.models import User, UserSession
from resorixtrack.timeutil import freeze


def test_password_is_stored_as_argon2id(app, org):
    u = db.session.get(User, org["anna"].id)
    assert u.password_hash.startswith("$argon2id$")
    assert PASSWORD not in u.password_hash


def test_login_success_sets_30_day_cookie(client, org):
    r = client.login("anna@example.com", remember=True)
    body = r.get_json()
    assert body["user"]["email"] == "anna@example.com"
    assert "password_hash" not in str(body)
    cookies = r.headers.getlist("Set-Cookie")
    session_cookie = next(c for c in cookies if c.startswith("rt_session="))
    assert "HttpOnly" in session_cookie
    assert "SameSite=Lax" in session_cookie
    assert f"Max-Age={30 * 24 * 3600}" in session_cookie
    assert client.get("/api/v1/me").status_code == 200


def test_login_without_remember_is_browser_session(client, org):
    r = client.login("anna@example.com", remember=False)
    session_cookie = next(c for c in r.headers.getlist("Set-Cookie") if c.startswith("rt_session="))
    assert "Max-Age" not in session_cookie and "Expires" not in session_cookie


def test_login_email_is_case_insensitive(client, org):
    client.login("ANNA@Example.com")


def test_wrong_password_and_unknown_user_look_the_same(client, org):
    r1 = client.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": "nope-nope-nope"})
    r2 = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "nope-nope-nope"})
    assert r1.status_code == r2.status_code == 401
    assert r1.get_json() == r2.get_json()


def test_login_throttling(client, org):
    for _ in range(5):
        client.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": "wrong-password"})
    r = client.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD})
    assert r.status_code == 429
    freeze(DEFAULT_NOW + timedelta(minutes=16))
    client.login("anna@example.com")


def test_inactive_user_cannot_login(client, org):
    org["anna"].is_active = False
    db.session.commit()
    r = client.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD})
    assert r.status_code == 401


def test_session_sliding_expiry(client, org):
    client.login("anna@example.com")
    sess = db.session.scalar(db.select(UserSession))
    first_expiry = sess.expires_at
    freeze(DEFAULT_NOW + timedelta(days=20))
    assert client.get("/api/v1/me").status_code == 200
    db.session.refresh(sess)
    assert sess.expires_at > first_expiry + timedelta(days=19)
    freeze(DEFAULT_NOW + timedelta(days=20 + 31))
    assert client.get("/api/v1/me").status_code == 401


def test_short_session_expires_after_idle(client, org):
    client.login("anna@example.com", remember=False)
    freeze(DEFAULT_NOW + timedelta(hours=13))
    assert client.get("/api/v1/me").status_code == 401


def test_csrf_required_for_cookie_auth(client, org):
    client.login("anna@example.com")
    r = client.post("/api/v1/clock/start", json={}, no_csrf=True)
    assert r.status_code == 403
    assert r.get_json()["error"]["code"] == "csrf_failed"
    r = client.post("/api/v1/clock/start", json={}, headers={"X-CSRF-Token": "forged"})
    assert r.status_code == 403
    assert client.post("/api/v1/clock/start", json={}).status_code == 200


def test_logout_revokes_session(client, org):
    client.login("anna@example.com")
    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.get("/api/v1/me").status_code == 401


def test_forgot_and_reset_password(client, org, outbox):
    r = client.post("/api/v1/auth/forgot", json={"email": "anna@example.com"})
    assert r.status_code == 200
    assert client.post("/api/v1/auth/forgot", json={"email": "ghost@example.com"}).status_code == 200
    assert len(outbox) == 1
    mail = outbox[0]
    assert mail.to == "anna@example.com"
    token = token_from(extract_link(mail, "reset"))
    info = client.post("/api/v1/auth/token-info", json={"token": token}).get_json()
    assert info["purpose"] == "reset"
    r = client.post("/api/v1/auth/reset", json={"token": token, "password": "short"})
    assert r.status_code == 422
    r = client.post("/api/v1/auth/reset", json={"token": token, "password": "A-much-better-passphrase-7"})
    assert r.status_code == 200
    # token is single-use
    assert client.post("/api/v1/auth/reset", json={"token": token, "password": "Another-passphrase-8"}).status_code == 422
    other = client.__class__(client.app, client.app.test_client())
    other.login("anna@example.com", "A-much-better-passphrase-7")
    assert any(m.meta["template"] == "password_changed" for m in outbox)


def test_reset_token_expires(client, org, outbox):
    client.post("/api/v1/auth/forgot", json={"email": "anna@example.com"})
    token = token_from(extract_link(outbox[0], "reset"))
    freeze(DEFAULT_NOW + timedelta(minutes=61))
    r = client.post("/api/v1/auth/reset", json={"token": token, "password": "A-much-better-passphrase-7"})
    assert r.status_code == 422


def test_invite_flow_with_german_locale(make_client, org, outbox):
    admin = make_client("admin@example.com")
    r = admin.post("/api/v1/users", json={"email": "new@example.com", "name": "Nina New", "team_id": org["team_a"].id})
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["invite_pending"] is True
    mail = next(m for m in outbox if m.to == "new@example.com")
    assert mail.meta["template"] == "invite"
    assert "cid:logo" in mail.html
    token = token_from(extract_link(mail, "invite"))
    c = make_client()
    r = c.post("/api/v1/auth/accept-invite", json={"token": token, "password": "Nina-strong-pass-1", "locale": "de"})
    assert r.status_code == 200, r.get_json()
    me = c.get("/api/v1/me").get_json()
    assert me["user"]["locale"] == "de"
    assert me["user"]["invite_pending"] is False


def test_german_emails(make_client, org, outbox):
    org["anna"].locale = "de"
    db.session.commit()
    c = make_client()
    c.post("/api/v1/auth/forgot", json={"email": "anna@example.com"})
    assert "Passwort" in outbox[-1].subject


def test_change_password_revokes_other_sessions(make_client, org):
    a1 = make_client("anna@example.com")
    a2 = make_client("anna@example.com")
    r = a1.post("/api/v1/auth/change-password", json={"current_password": PASSWORD,
                                                       "new_password": "Brand-new-passphrase-9"})
    assert r.status_code == 200
    assert a1.get("/api/v1/me").status_code == 200
    assert a2.get("/api/v1/me").status_code == 401


def test_weak_and_wrong_current_password(make_client, org):
    a = make_client("anna@example.com")
    r = a.post("/api/v1/auth/change-password", json={"current_password": "wrong", "new_password": "Brand-new-pass-9"})
    assert r.status_code == 422
    r = a.post("/api/v1/auth/change-password", json={"current_password": PASSWORD, "new_password": "password123"})
    assert r.status_code == 422
    assert r.get_json()["error"]["code"] == "weak_password"


def test_session_list_and_revoke(make_client, org):
    a1 = make_client("anna@example.com")
    a2 = make_client("anna@example.com")
    sessions = a1.get("/api/v1/auth/sessions").get_json()
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1
    other = next(s for s in sessions if not s["current"])
    assert a1.delete(f"/api/v1/auth/sessions/{other['id']}").status_code == 200
    assert a2.get("/api/v1/me").status_code == 401
    # cannot revoke someone else's session
    b = make_client("ben@example.com")
    mine = a1.get("/api/v1/auth/sessions").get_json()[0]["id"]
    assert b.delete(f"/api/v1/auth/sessions/{mine}").status_code == 404


def test_api_tokens_and_scopes(make_client, org):
    a = make_client("anna@example.com")
    # creating a token needs the account password (a stolen session alone is not enough)
    assert a.post("/api/v1/tokens", json={"name": "Desktop", "scopes": ["clock"]}).status_code == 422
    assert a.post("/api/v1/tokens", json={"name": "Desktop", "scopes": ["clock"], "current_password": "nope"}).status_code == 422
    r = a.post("/api/v1/tokens", json={"name": "Desktop", "scopes": ["clock"], "current_password": PASSWORD})
    assert r.status_code == 201
    token = r.get_json()["token"]
    assert token.startswith("rt_")
    assert r.get_json()["expires_at"] is not None  # tokens always expire (default 90 days)
    t = make_client()
    t.bearer = token
    assert t.get("/api/v1/clock").status_code == 200
    assert t.get("/api/v1/me").status_code == 200
    assert t.post("/api/v1/clock/start", json={}).status_code == 200  # no CSRF needed for bearer
    assert t.get("/api/v1/entries?from=2026-11-01&to=2026-11-30").status_code == 403  # missing scope
    assert t.post("/api/v1/tokens", json={"name": "x", "scopes": ["clock"], "current_password": PASSWORD}).status_code == 403
    # session-only routes refuse any token
    for url in ("/api/v1/auth/sessions", "/api/v1/tokens", "/api/v1/auth/login-history"):
        assert t.get(url).status_code == 403, url
    assert t.post("/api/v1/auth/sessions/revoke-others", json={}).status_code == 403
    assert t.patch("/api/v1/me", json={"name": "X"}).status_code == 403
    assert t.post("/api/v1/auth/change-password", json={"current_password": PASSWORD, "new_password": "Another-pass-99"}).status_code == 403
    # only admins can create admin tokens
    assert a.post("/api/v1/tokens", json={"name": "x", "scopes": ["admin"], "current_password": PASSWORD}).status_code == 422
    tid = a.get("/api/v1/tokens").get_json()[0]["id"]
    a.delete(f"/api/v1/tokens/{tid}")
    assert t.get("/api/v1/clock").status_code == 401
    t.bearer = "rt_invalid"
    assert t.get("/api/v1/clock").status_code == 401


def test_setup_wizard(client):
    r = client.get("/api/v1/meta").get_json()
    assert r["setup_required"] is False  # fixture marks setup complete


def test_setup_wizard_first_run(app, client):
    from resorixtrack.services import settings as st

    st.update({"setup_complete": False})
    db.session.commit()
    assert client.get("/api/v1/meta").get_json()["setup_required"] is True
    r = client.post("/api/v1/setup", json={"company_name": "RESORIX AG", "timezone": "Europe/Zurich",
                                          "admin_name": "Admin", "admin_email": "boss@example.nomail",
                                          "admin_password": "Very-secure-pass-1", "locale": "de"})
    assert r.status_code == 201, r.get_json()
    me = client.get("/api/v1/me").get_json()
    assert me["user"]["role"] == "admin" and me["user"]["locale"] == "de"
    assert client.post("/api/v1/setup", json={"company_name": "x", "admin_name": "x", "admin_email": "x@x.ch",
                                             "admin_password": "Very-secure-pass-1"}).status_code == 409


def test_unauthenticated_requests_are_rejected(client):
    for url in ("/api/v1/me", "/api/v1/clock", "/api/v1/users", "/api/v1/absences/pending",
                "/api/v1/admin/settings", "/api/v1/reports/balances?year=2026"):
        assert client.get(url).status_code == 401, url


def test_last_admin_cannot_be_demoted(make_client, org):
    admin = make_client("admin@example.com")
    r = admin.patch(f"/api/v1/users/{org['admin'].id}", json={"role": "employee"})
    assert r.status_code == 409
    second = make_user("admin2@example.com", role="admin")
    r = admin.patch(f"/api/v1/users/{org['admin'].id}", json={"role": "employee"})
    assert r.status_code == 200
    assert second.is_admin


def test_deactivated_user_sessions_are_revoked(make_client, org):
    anna = make_client("anna@example.com")
    admin = make_client("admin@example.com")
    assert admin.patch(f"/api/v1/users/{org['anna'].id}", json={"is_active": False}).status_code == 200
    assert anna.get("/api/v1/me").status_code == 401


# --------------------------------------------------------------------------- login log

def test_login_attempts_are_logged_with_reason(make_client, org):
    from resorixtrack.models import LoginAttempt

    c = make_client()
    c.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": "wrong-password"},
           headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0"})
    c.post("/api/v1/auth/login", json={"email": "ghost@example.com", "password": "whatever-123"})
    org["ben"].is_active = False
    db.session.commit()
    c.post("/api/v1/auth/login", json={"email": "ben@example.com", "password": PASSWORD})
    c.login("anna@example.com")
    rows = db.session.scalars(db.select(LoginAttempt).order_by(LoginAttempt.id)).all()
    assert [(r.email, r.success, r.reason) for r in rows] == [
        ("anna@example.com", False, "invalid_password"), ("gh***@example.com", False, "unknown_user"),
        ("ben@example.com", False, "inactive"), ("anna@example.com", True, "ok")]
    assert rows[0].user_id == org["anna"].id and "Firefox" in rows[0].user_agent
    assert rows[1].user_id is None
    hist = c.get("/api/v1/auth/login-history").get_json()
    assert [(h["success"], h["reason"]) for h in hist] == [(True, "ok"), (False, "invalid_password")]
    assert hist[1]["device"].startswith("Firefox")


def test_throttled_attempts_are_logged_but_do_not_extend_lockout(make_client, org):
    from resorixtrack.models import LoginAttempt

    c = make_client()
    for _ in range(5):
        c.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": "wrong-password"})
    for _ in range(3):
        assert c.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD}).status_code == 429
    # blocked requests are logged once per window, not once per request
    assert db.session.scalar(db.select(db.func.count(LoginAttempt.id)).where(LoginAttempt.reason == "throttled")) == 1
    freeze(DEFAULT_NOW + timedelta(minutes=16))
    c.login("anna@example.com")


def test_admin_login_log(make_client, org):
    make_client().post("/api/v1/auth/login", json={"email": "anna@example.com", "password": "wrong-password"})
    admin = make_client("admin@example.com")
    r = admin.get("/api/v1/admin/login-attempts").get_json()
    assert r["total"] == 2 and r["failed_last_24h"] == 1
    assert {i["reason"] for i in r["items"]} == {"ok", "invalid_password"}
    only_failed = admin.get("/api/v1/admin/login-attempts?success=false").get_json()
    assert [i["email"] for i in only_failed["items"]] == ["anna@example.com"]
    assert admin.get("/api/v1/admin/login-attempts?email=admin").get_json()["total"] == 1
    assert make_client("anna@example.com").get("/api/v1/admin/login-attempts").status_code == 403


def test_invite_and_reset_logins_are_logged(make_client, org, outbox):
    from resorixtrack.models import LoginAttempt

    c = make_client()
    c.post("/api/v1/auth/forgot", json={"email": "anna@example.com"})
    token = token_from(extract_link(outbox[-1], "reset"))
    c.post("/api/v1/auth/reset", json={"token": token, "password": "A-much-better-passphrase-7"})
    reasons = [r.reason for r in db.session.scalars(db.select(LoginAttempt).order_by(LoginAttempt.id))]
    assert reasons == ["reset_requested", "reset"]


def test_login_log_retention(app, org):
    from resorixtrack.models import LoginAttempt
    from resorixtrack.worker import cleanup

    db.session.add(LoginAttempt(email="old@x", success=False, reason="invalid_password",
                                at=DEFAULT_NOW - timedelta(days=400)))
    db.session.add(LoginAttempt(email="recent@x", success=False, reason="invalid_password",
                                at=DEFAULT_NOW - timedelta(days=200)))
    db.session.commit()
    cleanup()
    assert [r.email for r in db.session.scalars(db.select(LoginAttempt))] == ["recent@x"]


# --------------------------------------------------------------------------- admin sets password

def test_admin_sets_user_password(make_client, org, outbox):
    from resorixtrack.models import Revision

    anna_old = make_client("anna@example.com")
    admin = make_client("admin@example.com")
    url = f"/api/v1/users/{org['anna'].id}/password"
    r = admin.post(url, json={"password": "short", "admin_password": PASSWORD})
    assert r.status_code == 422 and r.get_json()["error"]["code"] == "weak_password"
    r = admin.post(url, json={"password": "Set-by-the-admin-2026"})
    assert r.status_code == 422  # the administrator must confirm their own password
    r = admin.post(url, json={"password": "Set-by-the-admin-2026", "admin_password": "wrong-admin-pw"})
    assert r.status_code == 422 and r.get_json()["error"]["fields"] == {"admin_password": "invalid"}
    r = admin.post(url, json={"password": "Set-by-the-admin-2026", "admin_password": PASSWORD})
    assert r.status_code == 200
    assert anna_old.get("/api/v1/me").status_code == 401  # all sessions revoked
    make_client().login("anna@example.com", "Set-by-the-admin-2026")
    bad = make_client().post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD})
    assert bad.status_code == 401
    mail = next(m for m in outbox if m.meta["template"] == "password_set_by_admin")
    assert mail.to == "anna@example.com" and "Set-by-the-admin-2026" not in mail.text + mail.html
    rev = db.session.scalar(db.select(Revision).where(Revision.action == "password_set"))
    assert rev.actor_id == org["admin"].id and "password" not in str(rev.after).lower().replace("password_set", "")
    assert db.session.get(User, org["anna"].id).password_hash.startswith("$argon2id$")


def test_admin_password_set_permissions_and_options(make_client, org, outbox):
    lead = make_client("lea@example.com")
    admin = make_client("admin@example.com")
    body = {"password": "Set-by-the-admin-2026", "admin_password": PASSWORD}
    assert lead.post(f"/api/v1/users/{org['anna'].id}/password", json=body).status_code == 403
    assert make_client("anna@example.com").post(f"/api/v1/users/{org['ben'].id}/password", json=body).status_code == 403
    r = admin.post(f"/api/v1/users/{org['admin'].id}/password", json=body)
    assert r.status_code == 422 and r.get_json()["error"]["code"] == "use_profile"
    outbox.clear()
    assert admin.post(f"/api/v1/users/{org['ben'].id}/password",
                      json={"password": "Another-admin-pass-77", "notify": False, "admin_password": PASSWORD}).status_code == 200
    assert not [m for m in outbox if m.to == "ben@example.com"]


def test_admin_password_activates_invited_user(make_client, org, outbox):
    admin = make_client("admin@example.com")
    u = admin.post("/api/v1/users", json={"email": "new@example.com", "name": "New Person"}).get_json()
    token = token_from(extract_link(next(m for m in outbox if m.to == "new@example.com"), "invite"))
    assert admin.post(f"/api/v1/users/{u['id']}/password",
                      json={"password": "Initial-pass-for-new-1", "admin_password": PASSWORD}).status_code == 200
    assert admin.get(f"/api/v1/users/{u['id']}").get_json()["invite_pending"] is False
    # the old invite link is invalid now
    assert make_client().post("/api/v1/auth/accept-invite", json={"token": token, "password": "Other-pass-123456"}).status_code == 422
    make_client().login("new@example.com", "Initial-pass-for-new-1")


def test_password_reset_revokes_api_tokens_and_links(make_client, org, outbox):
    """H3: account recovery must end every API token, not only browser sessions."""
    anna = make_client("anna@example.com")
    token = anna.post("/api/v1/tokens", json={"name": "d", "scopes": ["clock"], "current_password": PASSWORD}).get_json()["token"]
    t = make_client()
    t.bearer = token
    assert t.get("/api/v1/clock").status_code == 200
    c = make_client()
    c.post("/api/v1/auth/forgot", json={"email": "anna@example.com"})
    reset = token_from(extract_link(outbox[-1], "reset"))
    assert c.post("/api/v1/auth/reset", json={"token": reset, "password": "A-much-better-passphrase-7"}).status_code == 200
    assert t.get("/api/v1/clock").status_code == 401
    # changing the password in the profile does the same
    anna2 = make_client()
    anna2.login("anna@example.com", "A-much-better-passphrase-7")
    tok2 = anna2.post("/api/v1/tokens", json={"name": "d2", "scopes": ["clock"], "current_password": "A-much-better-passphrase-7"}).get_json()["token"]
    t.bearer = tok2
    assert t.get("/api/v1/clock").status_code == 200
    assert anna2.post("/api/v1/auth/change-password", json={"current_password": "A-much-better-passphrase-7",
                                                            "new_password": "Yet-another-passphrase-8"}).status_code == 200
    assert t.get("/api/v1/clock").status_code == 401
    # admin set-password and deactivation revoke tokens too
    admin = make_client("admin@example.com")
    anna3 = make_client()
    anna3.login("anna@example.com", "Yet-another-passphrase-8")
    tok3 = anna3.post("/api/v1/tokens", json={"name": "d3", "scopes": ["clock"], "current_password": "Yet-another-passphrase-8"}).get_json()["token"]
    t.bearer = tok3
    assert admin.post(f"/api/v1/users/{org['anna'].id}/password",
                      json={"password": "Set-by-the-admin-2026", "admin_password": PASSWORD}).status_code == 200
    assert t.get("/api/v1/clock").status_code == 401
    anna4 = make_client()
    anna4.login("anna@example.com", "Set-by-the-admin-2026")
    tok4 = anna4.post("/api/v1/tokens", json={"name": "d4", "scopes": ["clock"], "current_password": "Set-by-the-admin-2026"}).get_json()["token"]
    t.bearer = tok4
    assert admin.patch(f"/api/v1/users/{org['anna'].id}", json={"is_active": False}).status_code == 200
    assert admin.patch(f"/api/v1/users/{org['anna'].id}", json={"is_active": True}).status_code == 200
    assert t.get("/api/v1/clock").status_code == 401  # stays revoked after reactivation


def test_token_expiry_is_capped(make_client, org):
    admin = make_client("admin@example.com")
    r = admin.post("/api/v1/tokens", json={"name": "a", "scopes": ["admin"], "current_password": PASSWORD,
                                           "expires_in_days": 365}).get_json()
    from datetime import datetime

    exp = datetime.fromisoformat(r["expires_at"].replace("Z", "+00:00"))
    assert (exp - DEFAULT_NOW).days <= 90  # admin tokens: 90 days at most
    assert admin.post("/api/v1/tokens", json={"name": "b", "scopes": ["clock"], "current_password": PASSWORD,
                                              "expires_in_days": 4000}).status_code == 422


def test_unknown_emails_are_masked_in_the_login_log(make_client, org):
    from resorixtrack.models import LoginAttempt

    make_client().post("/api/v1/auth/login", json={"email": "MySecretPassw0rd!@example.com", "password": "x"})
    row = db.session.scalar(db.select(LoginAttempt).where(LoginAttempt.reason == "unknown_user"))
    assert row.email == "my***@example.com"


def test_throttle_is_per_email_and_ip(app, make_client, org):
    """A stranger hammering an address from one IP doesn't lock the real user out from elsewhere."""
    attacker = make_client()
    for _ in range(5):
        attacker.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": "wrong-password"})
    assert attacker.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD}).status_code == 429
    anna = make_client()
    r = anna.c.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD},
                    environ_base={"REMOTE_ADDR": "203.0.113.9"})
    assert r.status_code == 200
    # the wider per-email ceiling (5x) still blocks a distributed spray
    for i in range(25):
        attacker.c.post("/api/v1/auth/login", json={"email": "ben@example.com", "password": "wrong-password"},
                        environ_base={"REMOTE_ADDR": f"198.51.100.{i + 1}"})
    r = make_client().c.post("/api/v1/auth/login", json={"email": "ben@example.com", "password": PASSWORD},
                             environ_base={"REMOTE_ADDR": "203.0.113.77"})
    assert r.status_code == 429


def test_forgot_has_its_own_limit_and_never_locks_the_account(make_client, org, outbox):
    c = make_client()
    for _ in range(3):
        assert c.post("/api/v1/auth/forgot", json={"email": "anna@example.com"}).status_code == 200
    assert c.post("/api/v1/auth/forgot", json={"email": "anna@example.com"}).status_code == 429
    assert len([m for m in outbox if m.to == "anna@example.com"]) == 3
    make_client().login("anna@example.com")  # reset requests don't count as failed logins


def test_setup_code_required_in_production_mode(app, client):
    from resorixtrack.services import settings as st
    from resorixtrack.services import setup_code

    for u in db.session.scalars(db.select(User)):
        db.session.delete(u)
    st.update({"setup_complete": False})
    db.session.commit()
    app.config["SETUP_CODE_REQUIRED"] = True
    body = {"company_name": "X", "timezone": "Europe/Zurich", "admin_name": "A", "admin_email": "a@example.com",
            "admin_password": "Correct-Horse-42!", "holiday_preset": None}
    assert client.get("/api/v1/meta").get_json()["setup_code_required"] is True
    assert client.post("/api/v1/setup", json=body).status_code == 403
    code = setup_code.generate()
    assert client.post("/api/v1/setup", json={**body, "setup_code": "AAAA-BBBB-CCCC"}).status_code == 403
    assert client.post("/api/v1/setup", json={**body, "setup_code": code.lower()}).status_code == 201
    assert setup_code.verify(code) is False  # single use
    assert setup_code.needed() is False


def test_email_change_ends_sessions_and_notifies_old_address(make_client, org, outbox):
    anna = make_client("anna@example.com")
    admin = make_client("admin@example.com")
    assert admin.patch(f"/api/v1/users/{org['anna'].id}", json={"email": "anna.new@example.com"}).status_code == 200
    assert anna.get("/api/v1/me").status_code == 401
    mail = next(m for m in outbox if m.meta["template"] == "email_changed")
    assert mail.to == "anna@example.com" and "anna.new@example.com" in mail.text
    for bad in ("a@x.ch,b@evil.ch", "a b@x.ch", "a@x", "@x.ch", "a@@x.ch"):
        assert admin.patch(f"/api/v1/users/{org['anna'].id}", json={"email": bad}).status_code == 422, bad


def test_control_characters_and_date_bounds_are_rejected(make_client, org):
    anna = make_client("anna@example.com")
    assert anna.patch("/api/v1/me", json={"name": "Anna\r\nBcc: evil@example.com"}).status_code == 422
    assert anna.get("/api/v1/entries?from=0001-01-01&to=9999-12-31").status_code == 422
    assert anna.get("/api/v1/entries?from=2026-11-01&to=2026-11-30").status_code == 200


def test_absolute_session_lifetime(app, make_client, org):
    anna = make_client("anna@example.com")
    for day in range(0, 90, 10):  # used every 10 days: the 30-day window keeps sliding ...
        freeze(DEFAULT_NOW + timedelta(days=day))
        assert anna.get("/api/v1/me").status_code == 200, day
    freeze(DEFAULT_NOW + timedelta(days=91))
    assert anna.get("/api/v1/me").status_code == 401  # ... until the 90-day hard cap, regardless of use


def test_api_token_lifecycle_and_usage_are_audited(app, make_client, org):
    """Tokens: creation and revocation in the audit log; usage counted per token, logged once per day and IP."""
    from resorixtrack.models import LoginAttempt, Revision

    anna = make_client("anna@example.com")
    r = anna.post("/api/v1/tokens", json={"name": "Laptop", "scopes": ["clock", "entries:read"], "current_password": PASSWORD})
    tid, raw = r.get_json()["id"], r.get_json()["token"]
    created = db.session.scalar(db.select(Revision).where(Revision.entity == "api_token", Revision.action == "create"))
    assert created.entity_id == tid and created.after["scopes"] == ["clock", "entries:read"] and created.actor_id == org["anna"].id
    t = make_client()
    t.bearer = raw
    assert t.get("/api/v1/clock", headers={"X-Client": "desktop/1.2", "User-Agent": "RESORIXtrackDesktop/1.2"}).status_code == 200
    assert t.get("/api/v1/clock").status_code == 200
    tok = anna.get("/api/v1/tokens").get_json()[0]
    assert tok["use_count"] == 2 and tok["last_used_ip"] == "127.0.0.1" and tok["status"] == "active"
    rows = db.session.scalars(db.select(LoginAttempt).where(LoginAttempt.reason == "api_token")).all()
    assert len(rows) == 1 and rows[0].user_id == org["anna"].id and 'API token "Laptop"' in rows[0].user_agent and "desktop/1.2" in rows[0].user_agent
    # a different IP or a new day adds another audit row
    assert t.c.get("/api/v1/clock", headers={"Authorization": f"Bearer {raw}"}, environ_base={"REMOTE_ADDR": "203.0.113.5"}).status_code == 200
    freeze(DEFAULT_NOW + timedelta(days=1))
    assert t.get("/api/v1/clock").status_code == 200
    assert db.session.scalar(db.select(db.func.count(LoginAttempt.id)).where(LoginAttempt.reason == "api_token")) == 3
    assert any(h["reason"] == "api_token" for h in anna.get("/api/v1/auth/login-history").get_json())
    # the owner's revocation is logged
    assert anna.delete(f"/api/v1/tokens/{tid}").status_code == 200
    revoked = db.session.scalar(db.select(Revision).where(Revision.entity == "api_token", Revision.action == "revoke"))
    assert revoked.entity_id == tid and revoked.before["name"] == "Laptop" and revoked.actor_id == org["anna"].id
    assert t.get("/api/v1/clock").status_code == 401


def test_admin_token_overview_and_revocation(app, make_client, org):
    from resorixtrack.models import Notification, Revision

    anna = make_client("anna@example.com")
    raw = anna.post("/api/v1/tokens", json={"name": "Script", "scopes": ["reports:read"], "current_password": PASSWORD}).get_json()["token"]
    t = make_client()
    t.bearer = raw
    assert t.get("/api/v1/me").status_code == 200
    admin = make_client("admin@example.com")
    assert make_client("lea@example.com").get("/api/v1/admin/api-tokens").status_code == 403
    rows = admin.get("/api/v1/admin/api-tokens").get_json()
    row = next(x for x in rows if x["name"] == "Script")
    assert row["user"]["email"] == "anna@example.com" and row["scopes"] == ["reports:read"] and row["use_count"] == 1
    assert admin.delete(f"/api/v1/admin/api-tokens/{row['id']}", json={"reason": "Left the project"}).status_code == 200
    assert t.get("/api/v1/me").status_code == 401
    rev = db.session.scalar(db.select(Revision).where(Revision.entity == "api_token", Revision.action == "revoke"))
    assert rev.actor_id == org["admin"].id and rev.reason == "Left the project"
    assert db.session.scalar(db.select(Notification).where(Notification.kind == "token_revoked")).user_id == org["anna"].id
    assert not [x for x in admin.get("/api/v1/admin/api-tokens").get_json() if x["name"] == "Script"]
    assert next(x for x in admin.get("/api/v1/admin/api-tokens?include_inactive=1").get_json() if x["name"] == "Script")["status"] == "revoked"
    # company-wide switch: no new tokens, existing ones stop working
    raw2 = anna.post("/api/v1/tokens", json={"name": "Other", "scopes": ["clock"], "current_password": PASSWORD}).get_json()["token"]
    assert admin.patch("/api/v1/admin/settings", json={"api_tokens_enabled": False}).status_code == 200
    t.bearer = raw2
    assert t.get("/api/v1/clock").status_code == 401
    r = anna.post("/api/v1/tokens", json={"name": "Nope", "scopes": ["clock"], "current_password": PASSWORD})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "tokens_disabled"
    assert anna.get("/api/v1/me").get_json()["api_tokens_enabled"] is False
