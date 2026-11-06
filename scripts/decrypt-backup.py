#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Decrypt a RESORIXtrack backup (.zip.enc) without RESORIXtrack.

    pip install cryptography argon2-cffi
    BACKUP_PASSWORD=... python3 scripts/decrypt-backup.py resorixtrack-20261106-020000-auto.zip.enc out.zip
    (without BACKUP_PASSWORD in the environment the password is asked for)

Format "RTBK1": magic b"RTBK\\x01", 2-byte header length, JSON header (Argon2id parameters, salt, chunk size),
then ChaCha20-Poly1305 chunks; nonce = 11-byte counter + 1 byte last-chunk flag; the header is the associated data.
"""

import base64
import getpass
import json
import os
import sys

from argon2.low_level import Type, hash_secret_raw
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

MAGIC = b"RTBK\x01"


def main(src: str, dest: str) -> int:
    password = os.environ.get("BACKUP_PASSWORD") or getpass.getpass("Backup password: ")
    with open(src, "rb") as f, open(dest, "wb") as out:
        if f.read(5) != MAGIC:
            print("not an encrypted RESORIXtrack backup", file=sys.stderr)
            return 2
        header = f.read(int.from_bytes(f.read(2), "big"))
        meta = json.loads(header)
        key = hash_secret_raw(password.encode(), base64.b64decode(meta["salt"]), time_cost=meta["t"],
                              memory_cost=meta["m"], parallelism=meta["p"], hash_len=32, type=Type.ID)
        aead = ChaCha20Poly1305(key)
        size, counter = meta["chunk"] + 16, 0
        block = f.read(size)
        while True:
            nxt = f.read(size)
            last = not nxt
            nonce = counter.to_bytes(11, "big") + (b"\x01" if last else b"\x00")
            try:
                out.write(aead.decrypt(nonce, block, header))
            except InvalidTag:
                print("wrong password, or the file is damaged or truncated", file=sys.stderr)
                return 1
            if last:
                break
            block, counter = nxt, counter + 1
    print(f"decrypted to {dest}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
