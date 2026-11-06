# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Password-based, authenticated encryption of backup archives (streamed in chunks).

Format "RTBK1":

    magic   b"RTBK\\x01"
    header  2-byte big-endian length + JSON {"v": 1, "kdf": "argon2id", "t": 3, "m": 65536, "p": 1,
            "salt": <base64, 16 bytes>, "cipher": "chacha20poly1305", "chunk": 1048576}
    body    ChaCha20-Poly1305 chunks of `chunk` plaintext bytes, each followed by its 16-byte tag.
            nonce = 11-byte big-endian chunk counter + 1 byte "last chunk" flag; the header bytes are the
            associated data of every chunk.

The 256-bit key is derived from the backup password with Argon2id (64 MiB, 3 passes). A fresh random salt per
archive means a fresh key per archive, so the counter nonce never repeats. The last-chunk flag makes truncation
detectable; any other modification fails authentication. `scripts/decrypt-backup.py` is a standalone decryptor.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any, BinaryIO

from argon2.low_level import Type, hash_secret_raw
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

MAGIC = b"RTBK\x01"
CHUNK = 1024 * 1024
KDF = {"t": 3, "m": 65536, "p": 1}  # Argon2id: passes, KiB, lanes
MIN_PASSWORD_LENGTH = 12
TAG = 16


class BackupCryptoError(Exception):
    """Wrong password, damaged file, or not an encrypted backup at all."""


def derive_key(password: str, salt: bytes, t: int, m: int, p: int) -> bytes:
    return hash_secret_raw(password.encode("utf-8"), salt, time_cost=t, memory_cost=m, parallelism=p, hash_len=32, type=Type.ID)


def _nonce(counter: int, last: bool) -> bytes:
    return counter.to_bytes(11, "big") + (b"\x01" if last else b"\x00")


def is_encrypted(path: Path) -> bool:
    with open(path, "rb") as f:
        return f.read(len(MAGIC)) == MAGIC


def encrypt_file(src: Path, dest: Path, password: str, chunk: int = CHUNK) -> None:
    if not password:
        raise BackupCryptoError("A backup password is required")
    salt = os.urandom(16)
    header = json.dumps({"v": 1, "kdf": "argon2id", **KDF, "salt": base64.b64encode(salt).decode(),
                         "cipher": "chacha20poly1305", "chunk": chunk}, separators=(",", ":")).encode()
    aead = ChaCha20Poly1305(derive_key(password, salt, KDF["t"], KDF["m"], KDF["p"]))
    with open(src, "rb") as f, open(dest, "wb") as out:
        out.write(MAGIC + len(header).to_bytes(2, "big") + header)
        counter = 0
        block = f.read(chunk)
        while True:
            nxt = f.read(chunk)
            last = not nxt
            out.write(aead.encrypt(_nonce(counter, last), block, header))
            if last:
                break
            block, counter = nxt, counter + 1


def read_header(f: BinaryIO) -> tuple[dict[str, Any], bytes]:
    if f.read(len(MAGIC)) != MAGIC:
        raise BackupCryptoError("Not an encrypted RESORIXtrack backup (expected the RTBK header)")
    n = int.from_bytes(f.read(2), "big")
    header = f.read(n)
    try:
        meta = json.loads(header)
        assert meta["v"] == 1 and meta["kdf"] == "argon2id" and meta["cipher"] == "chacha20poly1305"
        assert all(isinstance(meta[k], int) and meta[k] > 0 for k in ("t", "m", "p", "chunk"))
        salt = base64.b64decode(meta["salt"])
        assert len(salt) == 16 and meta["chunk"] <= 64 * 1024 * 1024 and meta["m"] <= 1024 * 1024
    except (ValueError, KeyError, AssertionError, TypeError) as e:
        raise BackupCryptoError("Damaged backup header") from e
    return meta, header


def decrypt_file(src: Path, dest: Path, password: str) -> dict[str, Any]:
    """Decrypts `src` into `dest`; raises BackupCryptoError on a wrong password or a damaged/truncated file."""
    with open(src, "rb") as f, open(dest, "wb") as out:
        meta, header = read_header(f)
        aead = ChaCha20Poly1305(derive_key(password, base64.b64decode(meta["salt"]), meta["t"], meta["m"], meta["p"]))
        size = meta["chunk"] + TAG
        counter = 0
        block = f.read(size)
        while True:
            nxt = f.read(size)
            last = not nxt
            try:
                out.write(aead.decrypt(_nonce(counter, last), block, header))
            except InvalidTag as e:
                raise BackupCryptoError("Wrong backup password, or the file is damaged or truncated" if counter == 0
                                        else "The backup file is damaged or truncated") from e
            if last:
                break
            block, counter = nxt, counter + 1
    return meta
