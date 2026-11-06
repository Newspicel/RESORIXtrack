# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Consistent online backups of the SQLite database (+ attachments): a ZIP archive, encrypted with the backup password.

No unencrypted backup ever touches the disk: the ZIP is built in a private temporary directory and encrypted
(see backup_crypto) before it is moved into DATA_DIR/backups. Downloads deliver the encrypted file as is.
"""

from __future__ import annotations

import contextlib
import json
import re
import shutil
import sqlite3
import tempfile
import zipfile
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from flask import current_app

from ..errors import NotFound, Validation
from ..extensions import db
from . import backup_crypto

SUFFIX = ".zip.enc"
NAME_RE = re.compile(r"^resorixtrack-\d{8}-\d{6}(-[a-z0-9]+)?\.zip\.enc$")


def backup_password() -> str:
    pw = current_app.config.get("BACKUP_PASSWORD") or ""
    if len(pw) < backup_crypto.MIN_PASSWORD_LENGTH:
        raise Validation("BACKUP_PASSWORD is not configured on the server (at least 12 characters); backups are refused")
    return pw


def backups_dir() -> Path:
    p = Path(current_app.config["DATA_DIR"]) / "backups"
    p.mkdir(parents=True, exist_ok=True)
    return p


def database_path() -> Path:
    url = db.engine.url
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        raise Validation("Backups are only supported for file-based SQLite databases")
    return Path(url.database)


def _sqlite_backup(src: Path, dest: Path) -> None:
    """Uses SQLite's online backup API: consistent even while the app is writing."""
    source = sqlite3.connect(str(src))
    target = sqlite3.connect(str(dest))
    try:
        with target:
            source.backup(target)
        target.execute("PRAGMA journal_mode=DELETE")
    finally:
        target.close()
        source.close()


def create_backup(include_attachments: bool = True, label: str = "") -> dict[str, Any]:
    from .. import __version__

    now = datetime.now(UTC)
    suffix = f"-{re.sub(r'[^a-z0-9]', '', label.lower())[:16]}" if label else ""
    name = f"resorixtrack-{now:%Y%m%d-%H%M%S}{suffix}{SUFFIX}"
    dest = backups_dir() / name
    password = backup_password()
    att_dir = Path(current_app.config["DATA_DIR"]) / "attachments"
    with tempfile.TemporaryDirectory() as tmp:
        db_copy = Path(tmp) / "resorixtrack.db"
        _sqlite_backup(database_path(), db_copy)
        manifest = {"app": "resorixtrack", "version": __version__, "created_at": now.isoformat(),
                    "include_attachments": include_attachments, "format": 2, "encrypted": "RTBK1"}
        tmp_zip = Path(tmp) / "plain.zip"
        with zipfile.ZipFile(tmp_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(db_copy, "resorixtrack.db")
            if include_attachments and att_dir.exists():
                from ..models import Attachment

                live = set(db.session.scalars(db.select(Attachment.storage_name).where(
                    Attachment.is_deleted.is_(False))))
                for f in sorted(att_dir.iterdir()):
                    if f.is_file() and f.name in live:  # deleted documents are not carried into backups
                        zf.write(f, f"attachments/{f.name}")
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        tmp_enc = Path(tmp) / name
        backup_crypto.encrypt_file(tmp_zip, tmp_enc, password)
        tmp_zip.unlink()
        shutil.move(str(tmp_enc), dest)
    return describe(dest)


def describe(p: Path) -> dict[str, Any]:
    st = p.stat()
    return {"name": p.name, "size": st.st_size,
            "created_at": datetime.fromtimestamp(st.st_mtime, UTC).isoformat().replace("+00:00", "Z")}


def list_backups() -> list[dict[str, Any]]:
    return [describe(p) for p in sorted(backups_dir().glob(f"resorixtrack-*{SUFFIX}"), reverse=True)
            if NAME_RE.match(p.name)]


def backup_path(name: str) -> Path:
    if not NAME_RE.match(name or ""):
        raise NotFound("Backup not found")
    p = backups_dir() / name
    if not p.is_file():
        raise NotFound("Backup not found")
    return p


def delete_backup(name: str) -> None:
    backup_path(name).unlink()


def rotate(keep: int | None = None) -> int:
    keep = keep if keep is not None else int(current_app.config["BACKUP_KEEP"])
    files = sorted(backups_dir().glob(f"resorixtrack-*-auto{SUFFIX}"), reverse=True)
    removed = 0
    for p in files[keep:]:
        p.unlink()
        removed += 1
    return removed


@contextlib.contextmanager
def plain_archive(archive: Path, password: str | None = None) -> Iterator[Path]:
    """Yields a readable ZIP for an encrypted backup (decrypted into a private temp dir) or a plain ZIP."""
    if backup_crypto.is_encrypted(archive):
        with tempfile.TemporaryDirectory() as tmp:
            plain = Path(tmp) / "plain.zip"
            backup_crypto.decrypt_file(archive, plain, password if password is not None else backup_password())
            yield plain
    else:
        with open(archive, "rb") as f:
            if f.read(2) != b"PK":
                raise Validation("Not a RESORIXtrack backup archive")
        yield archive


def restore(archive: Path, data_dir: Path, password: str | None = None) -> dict[str, Any]:
    """Offline restore (CLI only; the app must be stopped). Keeps a copy of the current DB."""
    with plain_archive(archive, password) as plain, zipfile.ZipFile(plain) as zf:
        names = zf.namelist()
        if "resorixtrack.db" not in names or "manifest.json" not in names:
            raise Validation("Not a RESORIXtrack backup archive")
        manifest = json.loads(zf.read("manifest.json"))
        data_dir.mkdir(parents=True, exist_ok=True)
        db_path = data_dir / "resorixtrack.db"
        if db_path.exists():
            safety = data_dir / f"resorixtrack.db.before-restore-{datetime.now(UTC):%Y%m%d-%H%M%S}"
            shutil.copy2(db_path, safety)
        for ext in ("-wal", "-shm"):
            side = data_dir / f"resorixtrack.db{ext}"
            if side.exists():
                side.unlink()
        with zf.open("resorixtrack.db") as src, open(db_path, "wb") as out:
            shutil.copyfileobj(src, out)
        att_dir = data_dir / "attachments"
        att_dir.mkdir(exist_ok=True)
        count = 0
        for n in names:
            if n.startswith("attachments/") and not n.endswith("/"):
                fname = Path(n).name
                if not re.fullmatch(r"[0-9a-f]{32}", fname):
                    continue
                with zf.open(n) as src, open(att_dir / fname, "wb") as out:
                    shutil.copyfileobj(src, out)
                count += 1
    return {"manifest": manifest, "attachments": count}
