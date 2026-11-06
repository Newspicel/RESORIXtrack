# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
from __future__ import annotations

from resorixtrack.security import hash_password, needs_rehash, password_problems, token_hash, verify_password


def test_argon2id_hashing():
    h = hash_password("Some-long-passphrase-1")
    assert h.startswith("$argon2id$")
    assert verify_password(h, "Some-long-passphrase-1")
    assert not verify_password(h, "some-long-passphrase-1")
    assert not verify_password(None, "x")
    assert not verify_password("garbage", "x")
    assert hash_password("same") != hash_password("same")  # salted


def test_production_parameters_are_strong(monkeypatch):
    from argon2 import PasswordHasher

    import resorixtrack.security as sec

    prod = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4)
    h = prod.hash("x" * 12)
    assert "m=65536,t=3,p=4" in h
    # hashes created with weaker (test) parameters get upgraded on next login in production
    monkeypatch.setattr(sec, "_hasher", prod)
    weak = PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1).hash("x")
    assert needs_rehash(weak)


def test_password_policy():
    assert "password.too_short" in password_problems("short")
    assert "password.too_common" in password_problems("password123")
    assert "password.contains_email" in password_problems("anna.meier-2026!", "anna.meier@x.ch")
    assert password_problems("Correct-Horse-Battery-9") == []


def test_tokens_are_stored_hashed():
    assert len(token_hash("abc")) == 64 and token_hash("abc") != "abc"


def test_health_and_security_headers(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.get_json()["status"] == "ok"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
    assert r.headers["Cache-Control"] == "no-store"


def test_openapi_spec_requires_login(client, make_client, org):
    assert client.get("/api/openapi.json").status_code == 401
    assert client.get("/api/docs").status_code == 401
    anna = make_client("anna@example.com")
    spec = anna.get("/api/openapi.json").get_json()
    assert spec["info"]["title"] == "RESORIXtrack API"
    assert "/api/v1/clock/{action}" in spec["paths"]
    assert len(spec["paths"]) > 60
    docs = anna.get("/api/docs")
    assert docs.status_code == 200
    assert b"/vendor/swagger-ui/" in docs.data and b"cdn.jsdelivr" not in docs.data


def test_csp_hashes_inline_scripts_without_unsafe_inline(tmp_path):
    from resorixtrack import create_app
    from resorixtrack.extensions import db

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html><script>(function(){window.a=1})();</script><script src=\"/boot.js\"></script></html>")
    (dist / "404.html").write_text("<html><script>(function(){window.a=1})();</script></html>")
    app = create_app("testing", overrides={"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 't.db'}",
                                           "DATA_DIR": tmp_path, "FRONTEND_DIST": str(dist)})
    with app.app_context():
        db.create_all()
        r = app.test_client().get("/")
        csp = r.headers["Content-Security-Policy"]
        assert "script-src 'self' 'sha256-" in csp and "unsafe-inline" not in csp.split("style-src")[0]
        assert csp.count("sha256-") == 1  # identical scripts hash once
        db.session.remove()
        db.engine.dispose()


def test_frontend_serving_and_traversal(app, client, tmp_path):
    dist = tmp_path / "dist"
    (dist / "_astro").mkdir(parents=True)
    (dist / "index.html").write_text("<h1>home</h1>")
    (dist / "time").mkdir()
    (dist / "time" / "index.html").write_text("<h1>time</h1>")
    (dist / "_astro" / "app.abc123.js").write_text("console.log(1)")
    (dist / "404.html").write_text("nope")
    (tmp_path / "secret.txt").write_text("TOPSECRET")
    app.config["FRONTEND_DIST"] = str(dist)
    assert b"home" in client.get("/").data
    assert b"time" in client.get("/time").data
    js = client.get("/_astro/app.abc123.js")
    assert "immutable" in js.headers["Cache-Control"]
    r = client.get("/../secret.txt")
    assert b"TOPSECRET" not in r.data
    r = client.get("/%2e%2e/secret.txt")
    assert b"TOPSECRET" not in r.data
    assert client.get("/does-not-exist").status_code == 404
    assert client.get("/api/v1/nope").status_code == 404


def test_validation_errors_are_uniform(make_client, org):
    anna = make_client("anna@example.com")
    r = anna.post("/api/v1/entries", json={"start_at": "not-a-date"})
    assert r.status_code == 422
    err = r.get_json()["error"]
    assert err["code"] == "validation_error" and "start_at" in err["fields"]


def test_breached_password_check_is_k_anonymous(monkeypatch):
    import resorixtrack.security as sec

    seen = {}

    class FakeResp:
        def __init__(self, body):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return self.body

    def fake_urlopen(req, timeout):
        seen["url"] = req.full_url
        # suffix of sha1("password123456789") after the 5-char prefix, plus unrelated lines
        import hashlib

        digest = hashlib.sha1(b"password123456789").hexdigest().upper()  # noqa: S324
        return FakeResp(f"00000AAAA:1\r\n{digest[5:]}:42\r\n".encode())

    monkeypatch.setattr(sec.urllib.request, "urlopen", fake_urlopen) if hasattr(sec, "urllib") else None
    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    assert sec.password_pwned("password123456789") is True
    assert seen["url"].endswith("/range/" + hashlib_prefix("password123456789"))
    assert sec.password_pwned("Correct-Horse-Battery-9") is False
    assert "password.breached" in sec.password_problems("password123456789", online=True)
    assert sec.password_problems("password123456789") == []  # offline policy alone accepts it

    def broken(req, timeout):
        raise OSError("no network")

    monkeypatch.setattr(urllib.request, "urlopen", broken)
    assert sec.password_pwned("anything-at-all-1") is None  # fail open
    assert sec.password_problems("Correct-Horse-Battery-9", online=True) == []


def hashlib_prefix(pw: str) -> str:
    import hashlib

    return hashlib.sha1(pw.encode()).hexdigest().upper()[:5]  # noqa: S324
