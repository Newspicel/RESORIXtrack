"""Apps sign in with password (+ two-factor code) and receive a personal access token."""

from __future__ import annotations

from conftest import PASSWORD
from test_mfa import enable_for, next_code

from resorixtrack.extensions import db
from resorixtrack.models import LoginAttempt, Revision


def test_app_signs_in_and_gets_a_token(make_client, org):
    anon = make_client()
    r = anon.post("/api/v1/auth/token", json={"email": "anna@example.com", "password": PASSWORD, "name": "Desktop at home"})
    assert r.status_code == 201, r.get_json()
    body = r.get_json()
    assert body["scopes"] == ["clock", "entries:read"] and body["user"]["email"] == "anna@example.com" and body["expires_at"]
    app = make_client()
    app.bearer = body["token"]
    assert app.get("/api/v1/me").get_json()["user"]["email"] == "anna@example.com"
    assert app.get("/api/v1/me").get_json()["auth_method"] == "token"
    # the token is limited by its scopes and can't mint further tokens
    assert app.post("/api/v1/tokens", json={"name": "x", "current_password": PASSWORD}).status_code == 403
    assert app.get("/api/v1/reports/balances?year=2026&format=json").status_code == 403
    # audited and in the sign-in log
    rev = db.session.scalars(db.select(Revision).where(Revision.entity == "api_token").order_by(Revision.id.desc())).first()
    assert rev.action == "create" and rev.source == "app" and rev.after["name"] == "Desktop at home"
    issued = [a for a in db.session.scalars(db.select(LoginAttempt)).all() if a.reason == "token_issued"]
    assert len(issued) == 1 and issued[0].success and issued[0].email == "anna@example.com"
    assert any(a.reason == "api_token" for a in db.session.scalars(db.select(LoginAttempt)).all())  # first use per day is logged too
    # wrong password / unknown user: refused and logged; employees get no admin scope
    assert anon.post("/api/v1/auth/token", json={"email": "anna@example.com", "password": "nope", "name": "x"}).status_code == 401
    assert anon.post("/api/v1/auth/token", json={"email": "nobody@example.com", "password": "nope", "name": "x"}).status_code == 401
    assert anon.post("/api/v1/auth/token", json={"email": "anna@example.com", "password": PASSWORD, "name": "x", "scopes": ["admin"]}).status_code == 422
    reasons = [a.reason for a in db.session.scalars(db.select(LoginAttempt).order_by(LoginAttempt.id)).all()]
    assert reasons[-2:] == ["invalid_password", "unknown_user"]


def test_app_token_requires_the_second_factor_when_enabled(make_client, org):
    anna = make_client("anna@example.com")
    secret, _codes = enable_for(anna)
    anon = make_client()
    base = {"email": "anna@example.com", "password": PASSWORD, "name": "Phone"}
    r = anon.post("/api/v1/auth/token", json=base)
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "mfa_required"
    r = anon.post("/api/v1/auth/token", json={**base, "code": "000000"})
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "invalid_mfa"
    r = anon.post("/api/v1/auth/token", json={**base, "code": next_code(secret)})
    assert r.status_code == 201, r.get_json()
    app = make_client()
    app.bearer = r.get_json()["token"]
    assert app.get("/api/v1/me").status_code == 200


def test_app_token_respects_throttling_and_the_tokens_setting(make_client, org):
    anon = make_client()
    for _ in range(5):
        assert anon.post("/api/v1/auth/token", json={"email": "anna@example.com", "password": "wrong", "name": "x"}).status_code == 401
    assert anon.post("/api/v1/auth/token", json={"email": "anna@example.com", "password": PASSWORD, "name": "x"}).status_code == 429
    admin = make_client("admin@example.com")
    assert admin.patch("/api/v1/admin/settings", json={"api_tokens_enabled": False}).status_code == 200
    r = make_client().post("/api/v1/auth/token", json={"email": "ben@example.com", "password": PASSWORD, "name": "x"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "tokens_disabled"
