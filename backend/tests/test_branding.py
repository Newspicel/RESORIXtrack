# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Company branding: public logo endpoint, admin uploads (SVG sanitising, PNG), accent colour, email logo."""

from __future__ import annotations

import io
import struct
import zlib

from resorixtrack.services import branding, mail

SAFE_SVG = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></svg>'


def png_bytes() -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"\x00" + b"\x00\x00\x00\xff" * 1  # one RGBA pixel
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def upload(client, variant: str, data: bytes, name: str = "logo.svg"):
    return client.put(f"/api/v1/branding/logo/{variant}", data={"file": (io.BytesIO(data), name)},
                      content_type="multipart/form-data")


def test_public_defaults(client):
    r = client.get("/api/v1/branding")
    assert r.status_code == 200
    body = r.get_json()
    assert body["accent"] is None
    assert body["logos"]["dark"]["custom"] is False
    assert body["logos"]["light"]["url"].startswith("/api/v1/branding/logo/light")
    r = client.get("/api/v1/branding/logo/dark")
    assert r.status_code == 200
    assert r.mimetype == "image/svg+xml"
    assert "sandbox" in r.headers["Content-Security-Policy"]
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert b"<svg" in r.data
    assert client.get("/api/v1/branding/logo/purple").status_code == 404


def test_upload_requires_admin(make_client, org):
    assert upload(make_client("anna@example.com"), "dark", SAFE_SVG).status_code == 403
    assert upload(make_client("lea@example.com"), "dark", SAFE_SVG).status_code == 403
    assert make_client("anna@example.com").delete("/api/v1/branding/logo/dark").status_code == 403
    assert make_client("anna@example.com").patch("/api/v1/branding", json={"accent": "#ff0000"}).status_code == 403


def test_upload_svg_and_png_and_delete(make_client, org, app):
    admin = make_client("admin@example.com")
    r = upload(admin, "dark", SAFE_SVG)
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["logos"]["dark"]["custom"] is True
    served = admin.get("/api/v1/branding/logo/dark")
    assert served.data == SAFE_SVG and served.mimetype == "image/svg+xml"
    assert served.headers["Content-Security-Policy"].startswith("default-src 'none'")
    # replacing with PNG removes the SVG file
    r = upload(admin, "dark", png_bytes(), "logo.png")
    assert r.status_code == 200 and r.get_json()["logos"]["dark"]["type"] == "image/png"
    with app.app_context():
        assert branding.logo_path("dark").suffix == ".png"
        assert not (branding.branding_dir() / "logo-dark.svg").exists()
    assert admin.get("/api/v1/branding/logo/dark").mimetype == "image/png"
    # light variant untouched (still default)
    assert admin.get("/api/v1/branding").get_json()["logos"]["light"]["custom"] is False
    assert admin.delete("/api/v1/branding/logo/dark").status_code == 200
    assert admin.get("/api/v1/branding").get_json()["logos"]["dark"]["custom"] is False
    assert admin.delete("/api/v1/branding/logo/dark").status_code == 404


def test_svg_sanitising(make_client, org):
    admin = make_client("admin@example.com")
    bad = [
        b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)"/></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://evil.example/x.png"/></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>',
        b'<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css)</style></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.example)"/></svg>',
        b"<html><body>hi</body></html>",
        b"GIF89a....",
        b"",
    ]
    for data in bad:
        r = upload(admin, "light", data)
        assert r.status_code == 422, (data, r.get_json())
    assert admin.get("/api/v1/branding").get_json()["logos"]["light"]["custom"] is False
    # internal references and data: images are fine
    good = (b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
            b'<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use xlink:href="#g"/>'
            b'<image href="data:image/png;base64,iVBORw0KGgo="/></svg>')
    assert upload(admin, "light", good).status_code == 200
    too_big = b'<svg xmlns="http://www.w3.org/2000/svg">' + b"<!-- " + b"x" * (520 * 1024) + b" -->" + b"</svg>"
    assert upload(admin, "light", too_big).status_code == 422
    assert upload(admin, "light", SAFE_SVG, "x.svg").status_code == 200
    assert upload(admin, "nope", SAFE_SVG).status_code == 404


def test_accent_colour(make_client, org):
    admin = make_client("admin@example.com")
    assert admin.patch("/api/v1/branding", json={"accent": "red"}).status_code == 422
    assert admin.patch("/api/v1/branding", json={"accent": "#12345"}).status_code == 422
    r = admin.patch("/api/v1/branding", json={"accent": "#AB12ef"})
    assert r.status_code == 200 and r.get_json()["accent"] == "#ab12ef"
    assert admin.get("/api/v1/branding").get_json()["accent"] == "#ab12ef"
    assert admin.patch("/api/v1/branding", json={"accent": None}).get_json()["accent"] is None
    assert admin.patch("/api/v1/branding", json={"accent": ""}).get_json()["accent"] is None


def test_email_logo_follows_branding(make_client, org, app, outbox):
    admin = make_client("admin@example.com")
    with app.app_context():
        assert branding.email_logo_path() is not None  # built-in PNG
        m = mail.build("test", "someone@example.com", "en", user=org["admin"])
        assert 'src="cid:logo"' in m.html
        msg = mail._to_message(app, m)
        assert any(part.get("Content-ID") == "<logo>" for part in msg.walk())
    # custom SVG-only branding: emails show the company name instead of an image
    assert upload(admin, "light", SAFE_SVG).status_code == 200
    with app.app_context():
        assert branding.email_logo_path() is None
        m = mail.build("test", "someone@example.com", "en", user=org["admin"])
        assert "cid:logo" not in m.html and "RESORIX AG" in m.html
    # custom PNG: used in emails
    assert upload(admin, "dark", png_bytes(), "logo.png").status_code == 200
    with app.app_context():
        assert branding.email_logo_path().name == "logo-dark.png"
        m = mail.build("test", "someone@example.com", "en", user=org["admin"])
        assert 'src="cid:logo"' in m.html
