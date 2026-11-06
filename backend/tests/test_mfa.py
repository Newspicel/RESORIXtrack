# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Two-factor authentication: enrolment, sign-in second step, recovery codes, replay, admin reset."""

from __future__ import annotations

import time
from datetime import timedelta

import pyotp
import pytest
from conftest import DEFAULT_NOW, PASSWORD

from resorixtrack.extensions import db
from resorixtrack.models import LoginAttempt, Revision, User
from resorixtrack.services import mfa
from resorixtrack.timeutil import freeze


def next_code(secret: str) -> str:
    """A code of the *next* 30 s step: the enrolment already consumed the current step (replay guard)."""
    return pyotp.TOTP(secret).at(int(time.time()) + 30)


def enable_for(client, password=PASSWORD) -> tuple[str, list[str]]:
    r = client.post("/api/v1/auth/mfa/setup", json={"current_password": password})
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["otpauth_uri"].startswith("otpauth://totp/RESORIXtrack:") and "<svg" in body["qr_svg"]
    code = pyotp.TOTP(body["secret"]).now()
    r = client.post("/api/v1/auth/mfa/confirm", json={"code": code})
    assert r.status_code == 200, r.get_json()
    codes = r.get_json()["recovery_codes"]
    assert len(codes) == 8 and all(len(c) == 14 for c in codes)
    return body["secret"], codes


def test_secret_is_encrypted_at_rest_and_tamper_evident(app):
    blob = mfa.encrypt_secret("JBSWY3DPEHPK3PXP")
    assert blob.startswith("v1:") and "JBSWY3DPEHPK3PXP" not in blob
    assert mfa.decrypt_secret(blob) == "JBSWY3DPEHPK3PXP"
    with pytest.raises(ValueError):
        mfa.decrypt_secret(blob[:-4] + "AAAA")


def test_enable_requires_password_then_sign_in_needs_code(app, make_client, org):
    anna = make_client("anna@example.com")
    assert anna.get("/api/v1/auth/mfa").get_json()["enabled"] is False
    assert anna.post("/api/v1/auth/mfa/setup", json={"current_password": "wrong"}).status_code == 422
    secret, codes = enable_for(anna)
    assert anna.get("/api/v1/auth/mfa").get_json() == {"enabled": True, "enabled_at": anna.get("/api/v1/auth/mfa").get_json()["enabled_at"],
                                                        "recovery_codes_left": 8, "required_for_admins": False, "required": False, "pending": False}
    assert anna.get("/api/v1/me").get_json()["mfa_enabled"] is True
    assert db.session.scalar(db.select(Revision).where(Revision.action == "mfa_enabled")) is not None
    assert db.session.get(User, org["anna"].id).totp_secret.startswith("v1:")

    # password alone no longer signs in
    c = make_client()
    r = c.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD})
    assert r.status_code == 200 and r.get_json()["mfa_required"] is True
    assert c.get("/api/v1/me").status_code == 401
    token = r.get_json()["mfa_token"]
    # wrong code is logged and refused
    r = c.post("/api/v1/auth/mfa", json={"mfa_token": token, "code": "000000"})
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "invalid_mfa"
    assert db.session.scalar(db.select(LoginAttempt).where(LoginAttempt.reason == "invalid_mfa")) is not None
    # right code signs in; the one-time step token is consumed
    code = next_code(secret)
    r = c.post("/api/v1/auth/mfa", json={"mfa_token": token, "code": code})
    assert r.status_code == 200 and r.get_json()["user"]["email"] == "anna@example.com"
    assert c.get("/api/v1/me").status_code == 200
    assert c.post("/api/v1/auth/mfa", json={"mfa_token": token, "code": code}).status_code == 401
    # the same code can't be replayed in a new attempt (same 30 s step)
    c2 = make_client()
    token2 = c2.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD}).get_json()["mfa_token"]
    assert c2.post("/api/v1/auth/mfa", json={"mfa_token": token2, "code": code}).status_code == 401
    # a recovery code works exactly once
    assert c2.post("/api/v1/auth/mfa", json={"mfa_token": token2, "code": codes[0].lower()}).status_code == 200
    assert c2.get("/api/v1/auth/mfa").get_json()["recovery_codes_left"] == 7
    c3 = make_client()
    token3 = c3.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD}).get_json()["mfa_token"]
    assert c3.post("/api/v1/auth/mfa", json={"mfa_token": token3, "code": codes[0]}).status_code == 401


def test_mfa_token_expires_and_attempts_are_throttled(app, make_client, org):
    anna = make_client("anna@example.com")
    enable_for(anna)
    c = make_client()
    token = c.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD}).get_json()["mfa_token"]
    for _ in range(5):
        c.post("/api/v1/auth/mfa", json={"mfa_token": token, "code": "111111"})
    r = c.post("/api/v1/auth/mfa", json={"mfa_token": token, "code": "111111"})
    assert r.status_code == 429
    freeze(DEFAULT_NOW + timedelta(minutes=20))
    token = c.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD}).get_json()["mfa_token"]
    freeze(DEFAULT_NOW + timedelta(minutes=26))
    r = c.post("/api/v1/auth/mfa", json={"mfa_token": token, "code": "111111"})
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "mfa_expired"


def test_disable_regenerate_and_admin_reset(app, make_client, org):
    anna = make_client("anna@example.com")
    secret, _codes = enable_for(anna)
    code = next_code(secret)
    assert anna.post("/api/v1/auth/mfa/disable", json={"current_password": "wrong", "code": code}).status_code == 422
    assert anna.post("/api/v1/auth/mfa/disable", json={"current_password": PASSWORD, "code": "000000"}).status_code == 422
    # new recovery codes (uses the code; the replay guard means we need the next step for disable below)
    r = anna.post("/api/v1/auth/mfa/recovery-codes", json={"current_password": PASSWORD, "code": code})
    assert r.status_code == 200 and len(r.get_json()["recovery_codes"]) == 8
    recovery = r.get_json()["recovery_codes"][0]
    assert anna.post("/api/v1/auth/mfa/disable", json={"current_password": PASSWORD, "code": recovery}).status_code == 200
    assert anna.get("/api/v1/auth/mfa").get_json()["enabled"] is False
    assert db.session.scalar(db.select(Revision).where(Revision.action == "mfa_disabled")) is not None
    make_client().login("anna@example.com")  # password alone again

    # admin reset (lost phone): needs the admin's password, is logged, user can sign in with password only
    secret, _ = enable_for(anna)
    admin = make_client("admin@example.com")
    assert admin.get(f"/api/v1/users/{org['anna'].id}").get_json()["mfa_enabled"] is True
    assert admin.post(f"/api/v1/users/{org['anna'].id}/mfa/reset", json={"admin_password": "nope"}).status_code == 422
    assert make_client("lea@example.com").post(f"/api/v1/users/{org['anna'].id}/mfa/reset", json={"admin_password": PASSWORD}).status_code == 403
    assert admin.post(f"/api/v1/users/{org['anna'].id}/mfa/reset", json={"admin_password": PASSWORD}).status_code == 200
    assert db.session.scalar(db.select(Revision).where(Revision.action == "mfa_reset")) is not None
    make_client().login("anna@example.com")


def test_mfa_routes_are_session_only(make_client, org):
    anna = make_client("anna@example.com")
    tok = anna.post("/api/v1/tokens", json={"name": "d", "scopes": ["clock"], "current_password": PASSWORD}).get_json()["token"]
    t = make_client()
    t.bearer = tok
    assert t.post("/api/v1/auth/mfa/setup", json={"current_password": PASSWORD}).status_code == 403
    assert t.get("/api/v1/auth/mfa").status_code == 403


def test_two_factor_can_be_required_for_everyone(make_client, org):
    admin = make_client("admin@example.com")
    anna = make_client("anna@example.com")
    assert anna.get("/api/v1/me").get_json()["mfa_required"] is False
    assert admin.patch("/api/v1/admin/settings", json={"mfa_required_for_all": True}).status_code == 200
    me = anna.get("/api/v1/me").get_json()
    assert me["mfa_required"] is True and me["mfa_enabled"] is False
    assert anna.get("/api/v1/auth/mfa").get_json()["required"] is True
    # admins-only policy does not touch employees
    admin.patch("/api/v1/admin/settings", json={"mfa_required_for_all": False, "mfa_required_for_admins": True})
    assert anna.get("/api/v1/me").get_json()["mfa_required"] is False
    assert admin.get("/api/v1/me").get_json()["mfa_required"] is True
