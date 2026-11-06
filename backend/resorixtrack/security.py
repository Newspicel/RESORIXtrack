# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Password hashing (Argon2id) and opaque token helpers."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# Argon2id with the RFC 9106 "second recommended" profile (64 MiB, t=3, p=4).
_hasher = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4, hash_len=32, salt_len=16)
# At most this many hashes at a time per process: a burst of sign-in attempts can't exhaust memory.
_hash_slots = threading.BoundedSemaphore(4)

MIN_PASSWORD_LENGTH = 10
# Frequently used passwords of 10+ characters (shorter ones already fail the length rule). The online
# check against Have I Been Pwned (see ``password_pwned``) catches the long tail.
_COMMON = {
    "password", "password1", "password12", "password123", "password1234", "passw0rd123", "1234567890", "12345678910",
    "123456789a", "1234567890a", "qwertyuiop", "qwertyuiop1", "qwertzuiop", "qwertz1234", "1q2w3e4r5t", "1q2w3e4r5t6y",
    "letmein123", "welcome123", "welcome2024", "welcome2025", "welcome2026", "iloveyou12", "iloveyou123", "passwort123",
    "0123456789", "9876543210", "resorixtrack1", "resorix123", "changeme12", "changeme123", "administrator", "admin123456",
    "sunshine123", "princess123", "football123", "baseball123", "superman123", "trustno1234", "monkey12345",
    "dragon12345", "master12345", "summer2024", "summer2025", "summer2026", "winter2025", "winter2026",
    "january2026", "abcdefghij", "abcd1234567", "asdfghjkl1", "zxcvbnm123", "qazwsxedc1", "computer123", "internet123",
    "michael123", "jennifer123", "liverpool1", "chocolate1", "whatever12", "starwars123", "pokemon123", "samsung123",
}


def use_fast_hasher() -> None:
    """Cheap parameters for the test suite only."""
    global _hasher
    _hasher = PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1, hash_len=32, salt_len=16)


def hash_password(password: str) -> str:
    with _hash_slots:
        return _hasher.hash(password)


def verify_password(stored_hash: str | None, password: str) -> bool:
    with _hash_slots:
        if not stored_hash:
            # Spend comparable time so missing users can't be detected by timing.
            _hasher.hash(password)
            return False
        try:
            return _hasher.verify(stored_hash, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:  # pragma: no cover
        return True


def password_problems(password: str, email: str = "", name: str = "", online: bool = False) -> list[str]:
    """Return a list of i18n error keys; empty means acceptable. ``online`` adds the breached-password check."""
    problems: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append("password.too_short")
    if len(password) > 256:
        problems.append("password.too_long")
    lowered = password.lower()
    if lowered in _COMMON or len(set(password)) < 4:
        problems.append("password.too_common")
    local = email.split("@")[0].lower() if email else ""
    if local and len(local) >= 4 and local in lowered:
        problems.append("password.contains_email")
    if online and not problems and password_pwned(password):
        problems.append("password.breached")
    return problems


def password_pwned(password: str, timeout: float = 3.0) -> bool | None:
    """Check the password against Have I Been Pwned using k-anonymity: only the first five characters
    of its SHA-1 hash leave the server. Returns None when the service can't be reached (fail open:
    availability of sign-up must not depend on a third party)."""
    import urllib.request

    digest = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()  # noqa: S324 - protocol requirement
    prefix, suffix = digest[:5], digest[5:]
    req = urllib.request.Request(f"https://api.pwnedpasswords.com/range/{prefix}",
                                 headers={"User-Agent": "RESORIXtrack", "Add-Padding": "true"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - fixed https URL
            body = resp.read().decode("ascii", errors="ignore")
    except Exception:  # noqa: BLE001
        return None
    for line in body.splitlines():
        h, _, count = line.partition(":")
        if h.strip() == suffix and int(count or 0) > 0:
            return True
    return False


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_hash(token: str) -> str:
    """Tokens are high-entropy, so a fast hash is appropriate (and allows lookup by hash)."""
    return hashlib.sha256(token.encode()).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
