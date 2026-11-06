# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Two-factor authentication with time-based one-time passwords (TOTP, RFC 6238).

The TOTP secret is stored encrypted at rest (HMAC-SHA256 keystream under a key derived from SECRET_KEY,
random nonce per row). Recovery codes are stored as SHA-256 hashes and are single-use. A code can't be
replayed within its 30-second step.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from typing import Any

import pyotp
from flask import current_app

from ..errors import Conflict, Validation
from ..models import User
from ..security import token_hash, verify_password
from ..timeutil import utcnow
from . import settings as settings_svc

ISSUER = "RESORIXtrack"
RECOVERY_CODES = 8
_WINDOW = 1  # accept the previous/next 30 s step (clock drift)


# --------------------------------------------------------------------------- secret at rest

def _key() -> bytes:
    return hashlib.sha256(b"resorixtrack-totp:" + current_app.config["SECRET_KEY"].encode()).digest()


def _keystream(nonce: bytes, length: int) -> bytes:
    out = b""
    counter = 0
    while len(out) < length:
        out += hmac.new(_key(), nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        counter += 1
    return out[:length]


def encrypt_secret(secret: str) -> str:
    nonce = secrets.token_bytes(16)
    data = secret.encode()
    ct = bytes(a ^ b for a, b in zip(data, _keystream(nonce, len(data)), strict=True))
    tag = hmac.new(_key(), nonce + ct, hashlib.sha256).digest()[:16]
    return "v1:" + base64.b64encode(nonce + ct + tag).decode()


def decrypt_secret(blob: str) -> str:
    version, _, payload = blob.partition(":")
    if version != "v1":
        raise ValueError("unknown secret format")
    raw = base64.b64decode(payload)
    nonce, ct, tag = raw[:16], raw[16:-16], raw[-16:]
    if not hmac.compare_digest(hmac.new(_key(), nonce + ct, hashlib.sha256).digest()[:16], tag):
        raise ValueError("secret integrity check failed")
    return bytes(a ^ b for a, b in zip(ct, _keystream(nonce, len(ct)), strict=True)).decode()


# --------------------------------------------------------------------------- enrolment

def is_enabled(u: User) -> bool:
    return u.totp_enabled_at is not None and bool(u.totp_secret)


def begin_setup(u: User, password: str) -> dict[str, Any]:
    """Create a pending secret and return what the authenticator app needs (QR as SVG, manual key)."""
    if not verify_password(u.password_hash, password):
        raise Validation("Current password is incorrect", fields={"current_password": "invalid"})
    if is_enabled(u):
        raise Conflict("Two-factor authentication is already enabled", code="mfa_enabled")
    secret = pyotp.random_base32()
    u.totp_secret = encrypt_secret(secret)
    u.totp_enabled_at = None
    u.totp_recovery_codes = None
    uri = pyotp.TOTP(secret).provisioning_uri(name=u.email, issuer_name=ISSUER)
    return {"secret": secret, "otpauth_uri": uri, "qr_svg": qr_svg(uri)}


def qr_svg(data: str) -> str:
    import io

    import segno

    buf = io.BytesIO()
    segno.make(data, error="m").save(buf, kind="svg", scale=4, border=1, dark="#14254d", light=None, xmldecl=False)
    return buf.getvalue().decode()


def _new_recovery_codes() -> tuple[list[str], list[str]]:
    plain = ["-".join(secrets.token_hex(2).upper() for _ in range(3)) for _ in range(RECOVERY_CODES)]
    return plain, [token_hash(c) for c in plain]


def confirm_setup(u: User, code: str) -> list[str]:
    """Activate 2FA once the person proves the app works; returns the recovery codes (shown once)."""
    if not u.totp_secret or is_enabled(u):
        raise Conflict("Start the setup first", code="mfa_not_pending")
    if not _check_totp(u, code):
        raise Validation("The code is not valid", fields={"code": "invalid"})
    plain, hashed = _new_recovery_codes()
    u.totp_enabled_at = utcnow()
    u.totp_recovery_codes = hashed
    return plain


def regenerate_recovery_codes(u: User, password: str, code: str) -> list[str]:
    if not is_enabled(u):
        raise Conflict("Two-factor authentication is not enabled", code="mfa_disabled")
    if not verify_password(u.password_hash, password):
        raise Validation("Current password is incorrect", fields={"current_password": "invalid"})
    if not verify_code(u, code):
        raise Validation("The code is not valid", fields={"code": "invalid"})
    plain, hashed = _new_recovery_codes()
    u.totp_recovery_codes = hashed
    return plain


def disable(u: User, password: str, code: str) -> None:
    if not is_enabled(u):
        raise Conflict("Two-factor authentication is not enabled", code="mfa_disabled")
    if not verify_password(u.password_hash, password):
        raise Validation("Current password is incorrect", fields={"current_password": "invalid"})
    if not verify_code(u, code):
        raise Validation("The code is not valid", fields={"code": "invalid"})
    _clear(u)


def admin_reset(u: User) -> None:
    """An administrator removes 2FA (lost phone without recovery codes). Logged by the caller."""
    _clear(u)


def _clear(u: User) -> None:
    u.totp_secret = None
    u.totp_enabled_at = None
    u.totp_recovery_codes = None
    u.totp_last_step = None


# --------------------------------------------------------------------------- verification

def _check_totp(u: User, code: str) -> bool:
    digits = "".join(ch for ch in (code or "") if ch.isdigit())
    if len(digits) != 6:
        return False
    totp = pyotp.TOTP(decrypt_secret(u.totp_secret))
    now = int(time.time())
    if not totp.verify(digits, for_time=now, valid_window=_WINDOW):
        return False
    step = now // 30
    # the step the code was generated for (within the window)
    for candidate in (step - _WINDOW, step, step + _WINDOW):
        if totp.at(candidate * 30) == digits:
            if u.totp_last_step is not None and candidate <= u.totp_last_step:
                return False  # replay of an already used code
            u.totp_last_step = candidate
            return True
    return False


def verify_code(u: User, code: str) -> bool:
    """A 6-digit TOTP or one of the recovery codes (consumed on use)."""
    if not is_enabled(u):
        return False
    if _check_totp(u, code):
        return True
    normalized = (code or "").strip().upper().replace(" ", "")
    if not normalized:
        return False
    hashed = token_hash(normalized)
    codes = list(u.totp_recovery_codes or [])
    for stored in codes:
        if hmac.compare_digest(stored, hashed):
            codes.remove(stored)
            u.totp_recovery_codes = codes
            return True
    return False


def required_for(u: User) -> bool:
    """Company policy: two-factor authentication required for everyone, or for administrators."""
    return bool(settings_svc.get("mfa_required_for_all")) or (u.is_admin and bool(settings_svc.get("mfa_required_for_admins")))


def status(u: User) -> dict[str, Any]:
    return {"enabled": is_enabled(u), "enabled_at": u.totp_enabled_at.isoformat() + "Z" if u.totp_enabled_at else None,
            "recovery_codes_left": len(u.totp_recovery_codes or []) if is_enabled(u) else 0,
            "required_for_admins": bool(settings_svc.get("mfa_required_for_admins")),
            "required": required_for(u),
            "pending": bool(u.totp_secret) and not is_enabled(u)}
