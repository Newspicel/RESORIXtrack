# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""In-app notifications (bell) with optional email."""

from __future__ import annotations

from typing import Any

from ..extensions import db
from ..models import Notification, User
from ..timeutil import iso, utcnow


def notify(user: User, kind: str, **payload: Any) -> Notification:
    n = Notification(user_id=user.id, kind=kind, payload=payload)
    db.session.add(n)
    return n


def serialize(n: Notification) -> dict[str, Any]:
    return {"id": n.id, "kind": n.kind, "payload": n.payload, "read": n.read_at is not None,
            "created_at": iso(n.created_at)}


def list_for(user: User, unread_only: bool = False, limit: int = 50) -> list[Notification]:
    q = db.select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    return list(db.session.scalars(q.order_by(Notification.created_at.desc(), Notification.id.desc())
                                   .limit(limit)))


def unread_count(user: User) -> int:
    return db.session.scalar(db.select(db.func.count(Notification.id)).where(
        Notification.user_id == user.id, Notification.read_at.is_(None))) or 0


def mark_read(user: User, ids: list[int] | None) -> int:
    q = db.select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    if ids is not None:
        q = q.where(Notification.id.in_(ids))
    now = utcnow()
    count = 0
    for n in db.session.scalars(q):
        n.read_at = now
        count += 1
    return count
