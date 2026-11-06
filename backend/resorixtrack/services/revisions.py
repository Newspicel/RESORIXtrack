# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Change log. Every write to time-relevant data goes through ``record``, in the same transaction."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Any

from ..extensions import db
from ..models import (
    Absence,
    Attachment,
    BalanceAdjustment,
    Project,
    Revision,
    TimeEntry,
    User,
    VacationEntitlement,
    WorkLog,
    WorkSchedule,
)
from ..timeutil import iso


def _val(v: Any) -> Any:
    if isinstance(v, datetime):
        return iso(v)
    if isinstance(v, time):
        return v.strftime("%H:%M")
    if isinstance(v, date):
        return v.isoformat()
    return v


def snapshot(obj: Any) -> dict[str, Any]:
    if isinstance(obj, TimeEntry):
        keys = ("kind", "start_at", "end_at", "tz", "note", "source", "is_deleted")
    elif isinstance(obj, Absence):
        keys = ("type_id", "start_date", "end_date", "start_half", "end_half", "note", "status",
                "decision_note", "cancel_reason")
    elif isinstance(obj, BalanceAdjustment):
        keys = ("account", "amount", "effective_date", "kind", "reason", "is_deleted")
    elif isinstance(obj, WorkSchedule):
        keys = ("valid_from", "pensum_percent", "minutes_mon", "minutes_tue", "minutes_wed",
                "minutes_thu", "minutes_fri", "minutes_sat", "minutes_sun")
    elif isinstance(obj, VacationEntitlement):
        keys = ("year", "days", "note")
    elif isinstance(obj, Attachment):
        keys = ("absence_id", "filename", "content_type", "size", "sha256", "is_deleted")
    elif isinstance(obj, User):
        keys = ("email", "name", "role", "team_id", "holiday_calendar_id", "timezone",
                "employment_start", "employment_end", "vacation_days_per_year", "is_active")
    elif isinstance(obj, WorkLog):
        keys = ("date", "project_id", "customer_ref", "minutes", "start_time", "end_time", "note", "is_deleted")
    elif isinstance(obj, Project):
        keys = ("name", "code", "color", "description", "team_id", "is_active")
    else:  # pragma: no cover
        raise TypeError(type(obj))
    return {k: _val(getattr(obj, k)) for k in keys}


ENTITY_NAMES = {
    TimeEntry: "time_entry", Absence: "absence", BalanceAdjustment: "adjustment",
    WorkSchedule: "schedule", VacationEntitlement: "entitlement", User: "user", Attachment: "attachment",
    WorkLog: "work_log", Project: "project",
}


def record(*, obj: Any, action: str, actor: User | None, subject_user_id: int | None,
           before: dict[str, Any] | None, reason: str = "", source: str = "web") -> Revision:
    db.session.flush()  # ensure obj.id exists
    after = None if action == "purge" else snapshot(obj)
    rev = Revision(
        entity=ENTITY_NAMES[type(obj)], entity_id=obj.id, subject_user_id=subject_user_id,
        actor_id=actor.id if actor else None, action=action, before=before, after=after,
        reason=(reason or "").strip()[:500], source=source,
    )
    db.session.add(rev)
    return rev


def history(entity: str, entity_id: int) -> list[Revision]:
    return list(db.session.scalars(
        db.select(Revision).where(Revision.entity == entity, Revision.entity_id == entity_id)
        .order_by(Revision.at, Revision.id)))


def serialize(rev: Revision) -> dict[str, Any]:
    changed = []
    if rev.before and rev.after:
        changed = sorted(k for k in rev.after if rev.before.get(k) != rev.after.get(k))
    return {
        "id": rev.id, "entity": rev.entity, "entity_id": rev.entity_id, "action": rev.action,
        "actor": {"id": rev.actor.id, "name": rev.actor.name} if rev.actor else None,
        "subject_user_id": rev.subject_user_id, "before": rev.before, "after": rev.after,
        "changed": changed, "reason": rev.reason, "source": rev.source, "at": iso(rev.at),
    }
