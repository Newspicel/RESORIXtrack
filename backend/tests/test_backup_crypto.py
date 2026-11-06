# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Encrypted backups: the archive format, wrong passwords, tampering, and the mandatory password."""

from __future__ import annotations

import os
import secrets

import pytest

from resorixtrack import create_app
from resorixtrack.services import backup_crypto as bc

PW = "correct horse battery staple"


def _enc(tmp_path, data: bytes, chunk: int = 4096):
    src = tmp_path / "plain"
    src.write_bytes(data)
    enc = tmp_path / "enc"
    bc.encrypt_file(src, enc, PW, chunk=chunk)
    return src, enc


@pytest.mark.parametrize("size", [0, 1, 4095, 4096, 4097, 8192, 10_000])
def test_roundtrip_across_chunk_boundaries(tmp_path, size):
    src, enc = _enc(tmp_path, os.urandom(size))
    raw = enc.read_bytes()
    assert raw[:5] == bc.MAGIC and bc.is_encrypted(enc)
    out = tmp_path / "out"
    meta = bc.decrypt_file(enc, out, PW)
    assert out.read_bytes() == src.read_bytes()
    assert meta["kdf"] == "argon2id" and meta["cipher"] == "chacha20poly1305" and meta["chunk"] == 4096
    # ciphertext = header + per chunk (chunk + 16-byte tag); even an empty file carries one authenticated chunk
    chunks = max(1, -(-size // 4096))
    header_len = 7 + int.from_bytes(raw[5:7], "big")
    assert len(raw) == header_len + size + 16 * chunks


def test_plaintext_is_not_visible(tmp_path):
    payload = b"SQLite format 3\x00" + b"PRIVATE-NOTE " * 1000
    _, enc = _enc(tmp_path, payload)
    raw = enc.read_bytes()
    assert b"SQLite format 3" not in raw and b"PRIVATE-NOTE" not in raw and b"PK" not in raw[:5]


def test_two_encryptions_differ(tmp_path):
    src, enc = _enc(tmp_path, b"same content" * 100)
    enc2 = tmp_path / "enc2"
    bc.encrypt_file(src, enc2, PW, chunk=4096)
    assert enc.read_bytes() != enc2.read_bytes()  # fresh salt -> fresh key and ciphertext


def test_wrong_password_truncation_and_tampering(tmp_path):
    _, enc = _enc(tmp_path, os.urandom(10_000))
    raw = enc.read_bytes()
    out = tmp_path / "out"
    with pytest.raises(bc.BackupCryptoError, match="Wrong backup password"):
        bc.decrypt_file(enc, out, "not the password")
    header_len = 7 + int.from_bytes(raw[5:7], "big")
    cases = {
        "bit flip in the body": raw[:-1] + bytes([raw[-1] ^ 1]),
        "bit flip in the header": raw[:10] + bytes([raw[10] ^ 1]) + raw[11:],
        "truncated mid-chunk": raw[:-10],
        "last chunk dropped": raw[: header_len + 2 * (4096 + 16)],
        "chunk reordered": raw[:header_len] + raw[header_len + 4112: header_len + 2 * 4112] + raw[header_len: header_len + 4112] + raw[header_len + 2 * 4112:],
    }
    for _label, data in cases.items():
        p = tmp_path / "bad"
        p.write_bytes(data)
        with pytest.raises(bc.BackupCryptoError):
            bc.decrypt_file(p, out, PW)
    plain = tmp_path / "zip"
    plain.write_bytes(b"PK\x03\x04 not encrypted")
    with pytest.raises(bc.BackupCryptoError, match="Not an encrypted"):
        bc.decrypt_file(plain, out, PW)
    assert not bc.is_encrypted(plain)


def test_empty_password_refused(tmp_path):
    src = tmp_path / "p"
    src.write_bytes(b"x")
    with pytest.raises(bc.BackupCryptoError):
        bc.encrypt_file(src, tmp_path / "e", "")


def test_production_refuses_to_start_without_backup_password(tmp_path):
    overrides = {"SECRET_KEY": secrets.token_urlsafe(48), "DATA_DIR": tmp_path,
                 "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'p.db'}", "BACKUP_PASSWORD": ""}
    with pytest.raises(RuntimeError, match="BACKUP_PASSWORD"):
        create_app("production", overrides=overrides)
    overrides["BACKUP_PASSWORD"] = "change-me-please"
    with pytest.raises(RuntimeError, match="BACKUP_PASSWORD"):
        create_app("production", overrides=overrides)
    overrides["BACKUP_PASSWORD"] = "short"
    with pytest.raises(RuntimeError, match="BACKUP_PASSWORD"):
        create_app("production", overrides=overrides)
    overrides["BACKUP_PASSWORD"] = "a proper backup passphrase"
    assert create_app("production", overrides=overrides).config["BACKUP_PASSWORD"] == "a proper backup passphrase"
