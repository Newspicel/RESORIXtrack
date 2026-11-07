# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Time entries and the clock (idle <-> working; a break is simply a clock-out, "clock out later" schedules it)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from flask import current_app

from ..errors import Conflict, Forbidden, NotFound, Validation
from ..extensions import db
from ..models import TimeEntry, User
from ..timeutil import iso, local_today, utcnow, zone
from . import mail, notifications, permissions, revisions
from . import settings as settings_svc

MAX_ENTRY = timedelta(hours=24)
FUTURE_TOLERANCE = timedelta(minutes=2)
BACKDATE_NOTE_AFTER = timedelta(minutes=15)  # older clock timestamps are marked in the history
CLOCK_BACKDATE_LIMIT = timedelta(hours=48)


# --------------------------------------------------------------------------- serialization

def serialize(e: TimeEntry, edited_ids: set[int] | None = None) -> dict[str, Any]:
    end = e.end_at
    minutes = ((end or utcnow()) - e.start_at).total_seconds() / 60.0
    return {
        "id": e.id, "user_id": e.user_id, "kind": e.kind, "start_at": iso(e.start_at),
        "end_at": iso(end), "running": end is None, "scheduled_end_at": iso(e.scheduled_end_at),
        "tz": e.tz, "note": e.note, "source": e.source,
        "minutes": round(max(0.0, minutes), 2), "created_by_id": e.created_by_id,
        "edited": bool(edited_ids and e.id in edited_ids),
        "corrected": e.created_by_id is not None and e.created_by_id != e.user_id,
        "created_at": iso(e.created_at), "updated_at": iso(e.updated_at),
    }


def edited_entry_ids(entry_ids: list[int]) -> set[int]:
    """Entries that have revisions beyond their initial creation."""
    from ..models import Revision

    if not entry_ids:
        return set()
    rows = db.session.execute(db.select(Revision.entity_id).where(
        Revision.entity == "time_entry", Revision.entity_id.in_(entry_ids),
        Revision.action.in_(("update", "delete", "restore"))).distinct())
    return {r[0] for r in rows}


def corrected_entry_ids(entry_ids: list[int], owner_id: int) -> set[int]:
    from ..models import Revision

    if not entry_ids:
        return set()
    rows = db.session.execute(db.select(Revision.entity_id).where(
        Revision.entity == "time_entry", Revision.entity_id.in_(entry_ids),
        Revision.actor_id != owner_id).distinct())
    return {r[0] for r in rows}


# --------------------------------------------------------------------------- guards

def ensure_unlocked(user: User, *dts: datetime | None) -> None:
    """Signed-off months are read-only (see services.signoffs)."""
    from . import signoffs

    signoffs.ensure_open_instants(user, *dts)


def ensure_employed(user: User, t: datetime) -> None:
    """Clocking is only possible within the employment period."""
    day = t.astimezone(zone(user.timezone)).date()
    if user.employment_end is not None and day > user.employment_end:
        raise Conflict("Employment has ended; the clock can no longer be used", code="employment_ended")
    if user.employment_start is not None and day < user.employment_start:
        raise Conflict("Employment has not started yet", code="not_employed")


def stop_running(user: User, actor: User | None, reason: str = "") -> TimeEntry | None:
    """Close a running entry now (used when an account is deactivated)."""
    e = db.session.scalars(db.select(TimeEntry).where(
        TimeEntry.user_id == user.id, TimeEntry.is_deleted.is_(False), TimeEntry.end_at.is_(None)).limit(1)).first()
    if e is None:
        return None
    before = revisions.snapshot(e)
    e.end_at = max(utcnow().replace(microsecond=0), e.start_at + timedelta(seconds=1))
    revisions.record(obj=e, action="update", actor=actor, subject_user_id=user.id, before=before, reason=reason)
    return e


def _check_overlap(user_id: int, start: datetime, end: datetime | None, exclude_id: int | None = None) -> None:
    far = end or (utcnow() + timedelta(days=3650))
    q = db.select(TimeEntry).where(
        TimeEntry.user_id == user_id, TimeEntry.is_deleted.is_(False), TimeEntry.start_at < far,
        db.or_(TimeEntry.end_at.is_(None), TimeEntry.end_at > start))
    if exclude_id:
        q = q.where(TimeEntry.id != exclude_id)
    other = db.session.scalars(q.limit(1)).first()
    if other is not None:
        raise Conflict("This time overlaps another entry", code="overlap",
                       fields={"overlaps": serialize(other)})


def _validate_interval(start: datetime, end: datetime | None) -> None:
    now = utcnow()
    if start > now + FUTURE_TOLERANCE:
        raise Validation("Start time is in the future", fields={"start_at": "future"})
    if end is not None:
        if end <= start:
            raise Validation("End must be after start", fields={"end_at": "before_start"})
        if end > now + FUTURE_TOLERANCE:
            raise Validation("End time is in the future", fields={"end_at": "future"})
        if end - start > MAX_ENTRY:
            raise Validation("An entry cannot be longer than 24 hours", fields={"end_at": "too_long"})


def _reason_required(actor: User, owner: User, *dts: datetime | None) -> bool:
    if actor.id != owner.id:
        return True
    if not settings_svc.get("reason_required_for_past_edits"):
        return False
    today = local_today(owner.timezone)
    return any(dt is not None and dt.astimezone(zone(owner.timezone)).date() < today for dt in dts)


def _authorize(actor: User, owner: User) -> None:
    if actor.id != owner.id and not permissions.can_manage_user(actor, owner):
        raise Forbidden("You can only change your own entries or those of teams you lead")


def _notify_correction(actor: User, owner: User, entry: TimeEntry, action: str, reason: str) -> None:
    if actor.id == owner.id:
        return
    notifications.notify(owner, "entry_corrected", entry_id=entry.id, action=action, actor_id=actor.id,
                         actor_name=actor.name, reason=reason, start_at=iso(entry.start_at),
                         end_at=iso(entry.end_at))
    if owner.notify_email_on_correction and owner.is_active:
        mail.send(mail.build("entry_corrected", owner.email, owner.locale, user=owner, actor=actor,
                             action=action, reason=reason, entry=entry,
                             local_start=entry.start_at.astimezone(zone(owner.timezone)),
                             local_end=entry.end_at.astimezone(zone(owner.timezone)) if entry.end_at else None))


def get_entry(entry_id: int) -> TimeEntry:
    e = db.session.get(TimeEntry, entry_id)
    if e is None:
        raise NotFound("Entry not found")
    return e


# --------------------------------------------------------------------------- CRUD

def create_entry(actor: User, owner: User, *, kind: str, start_at: datetime, end_at: datetime | None,
                 note: str = "", reason: str = "", source: str = "manual") -> TimeEntry:
    _authorize(actor, owner)
    if kind not in ("work", "break"):
        raise Validation("Invalid kind", fields={"kind": "invalid"})
    if end_at is None:
        raise Validation("End time is required for manual entries", fields={"end_at": "required"})
    _validate_interval(start_at, end_at)
    if _reason_required(actor, owner, start_at) and not reason.strip():
        raise Validation("Please give a reason for this change", fields={"reason": "required"})
    ensure_unlocked(owner, start_at, end_at)
    _check_overlap(owner.id, start_at, end_at)
    e = TimeEntry(user_id=owner.id, kind=kind, start_at=start_at, end_at=end_at, tz=owner.timezone,
                  note=note.strip()[:500], source=source, created_by_id=actor.id)
    db.session.add(e)
    revisions.record(obj=e, action="create", actor=actor, subject_user_id=owner.id, before=None,
                     reason=reason, source=source)
    _notify_correction(actor, owner, e, "create", reason)
    return e


def update_entry(actor: User, entry: TimeEntry, changes: dict[str, Any], reason: str = "",
                 source: str = "web") -> TimeEntry:
    owner = db.session.get(User, entry.user_id)
    _authorize(actor, owner)
    if entry.is_deleted:
        raise Conflict("Entry was deleted", code="deleted")
    before = revisions.snapshot(entry)
    start = changes.get("start_at", entry.start_at)
    end = changes.get("end_at", entry.end_at) if "end_at" in changes else entry.end_at
    if entry.end_at is not None and end is None:
        raise Validation("A finished entry cannot be reopened", fields={"end_at": "required"})
    if start != entry.start_at or end != entry.end_at:
        _validate_interval(start, end)
    if _reason_required(actor, owner, entry.start_at, start) and not reason.strip():
        raise Validation("Please give a reason for this change", fields={"reason": "required"})
    ensure_unlocked(owner, entry.start_at, entry.end_at, start, end)
    _check_overlap(owner.id, start, end, exclude_id=entry.id)
    entry.start_at = start
    entry.end_at = end
    if "kind" in changes:
        if changes["kind"] not in ("work", "break"):
            raise Validation("Invalid kind", fields={"kind": "invalid"})
        entry.kind = changes["kind"]
    if "note" in changes:
        entry.note = (changes["note"] or "").strip()[:500]
    if revisions.snapshot(entry) == before:
        return entry
    entry.updated_at = utcnow()
    revisions.record(obj=entry, action="update", actor=actor, subject_user_id=owner.id, before=before,
                     reason=reason, source=source)
    _notify_correction(actor, owner, entry, "update", reason)
    return entry


def delete_entry(actor: User, entry: TimeEntry, reason: str = "", source: str = "web") -> None:
    owner = db.session.get(User, entry.user_id)
    _authorize(actor, owner)
    if entry.is_deleted:
        return
    if _reason_required(actor, owner, entry.start_at) and not reason.strip():
        raise Validation("Please give a reason for this change", fields={"reason": "required"})
    ensure_unlocked(owner, entry.start_at, entry.end_at)
    before = revisions.snapshot(entry)
    entry.is_deleted = True
    if entry.end_at is None:
        entry.end_at = max(utcnow(), entry.start_at + timedelta(seconds=1))
    revisions.record(obj=entry, action="delete", actor=actor, subject_user_id=owner.id, before=before,
                     reason=reason, source=source)
    _notify_correction(actor, owner, entry, "delete", reason)


def list_entries(user: User, start: datetime, end: datetime, include_deleted: bool = False) -> list[TimeEntry]:
    q = db.select(TimeEntry).where(TimeEntry.user_id == user.id, TimeEntry.start_at < end,
                                   db.or_(TimeEntry.end_at.is_(None), TimeEntry.end_at > start))
    if not include_deleted:
        q = q.where(TimeEntry.is_deleted.is_(False))
    return list(db.session.scalars(q.order_by(TimeEntry.start_at)))


def dispute(actor: User, entry: TimeEntry, message: str) -> None:
    """Employee disagrees with a correction: notify whoever changed it last."""
    if actor.id != entry.user_id:
        raise Forbidden("Only the owner can dispute a correction")
    if not message.strip():
        raise Validation("Please describe what is wrong", fields={"message": "required"})
    hist = revisions.history("time_entry", entry.id)
    correctors = [r.actor for r in hist if r.actor and r.actor.id != actor.id]
    if not correctors:
        raise Conflict("This entry was not changed by someone else", code="nothing_to_dispute")
    target = correctors[-1]
    revisions.record(obj=entry, action="dispute", actor=actor, subject_user_id=actor.id,
                     before=revisions.snapshot(entry), reason=message)
    notifications.notify(target, "entry_disputed", entry_id=entry.id, actor_id=actor.id,
                         actor_name=actor.name, message=message.strip()[:500])
    mail.send(mail.build("entry_disputed", target.email, target.locale, user=target, actor=actor,
                         message=message.strip(), entry=entry,
                         local_start=entry.start_at.astimezone(zone(actor.timezone))))


# --------------------------------------------------------------------------- clock

def open_entry(user: User) -> TimeEntry | None:
    return db.session.scalars(db.select(TimeEntry).where(
        TimeEntry.user_id == user.id, TimeEntry.end_at.is_(None), TimeEntry.is_deleted.is_(False))
        .order_by(TimeEntry.start_at.desc()).limit(1)).first()


def clock_state(user: User) -> dict[str, Any]:
    close_due_scheduled(user)
    e = open_entry(user)
    today_start, today_end = _today_bounds(user)
    now = utcnow()
    worked = 0.0
    first: datetime | None = None
    last: datetime | None = None
    for t in list_entries(user, today_start, today_end):
        if t.kind != "work":  # legacy break rows (pauses were removed: a break is a clock-out)
            continue
        a, b = max(t.start_at, today_start), min(t.end_at or now, today_end)
        if b <= a:
            continue
        worked += (b - a).total_seconds() / 60
        first = a if first is None else min(first, a)
        last = b if last is None else max(last, b)
    # Breaks are the gaps between the work entries of the day (same definition as the time account).
    breaks = max(0.0, (last - first).total_seconds() / 60 - worked) if first and last else 0.0
    return {"state": "idle" if e is None else "working", "entry": serialize(e) if e else None,
            "since": iso(e.start_at) if e else None,
            "scheduled_end": iso(e.scheduled_end_at) if e is not None and e.scheduled_end_at else None,
            "today_worked_min": round(worked, 2), "today_break_min": round(breaks, 2),
            "server_time": iso(now)}


def _today_bounds(user: User) -> tuple[datetime, datetime]:
    from ..timeutil import day_bounds_utc

    return day_bounds_utc(local_today(user.timezone), user.timezone)


def _clock_time(at: datetime | None, current: TimeEntry | None) -> datetime:
    now = utcnow()
    if at is None:
        t = now
    else:
        if at > now + FUTURE_TOLERANCE:
            raise Validation("Clock time is in the future", fields={"at": "future"})
        if at < now - CLOCK_BACKDATE_LIMIT:
            raise Validation("Clock time is too far in the past; add a manual entry instead",
                             fields={"at": "too_old"})
        t = min(at, now)
    t = t.replace(microsecond=0)
    if current is not None and t < current.start_at:
        if at is None or current.start_at - t <= timedelta(seconds=5):
            return current.start_at  # rapid clicks: entries are kept >= 1 s apart
        raise Conflict("Clock time is before the current entry started", code="clock_order")
    return t


def _start_new(user: User, kind: str, t: datetime, source: str) -> TimeEntry:
    ensure_unlocked(user, t)
    ensure_employed(user, t)
    last = db.session.scalars(db.select(TimeEntry).where(
        TimeEntry.user_id == user.id, TimeEntry.is_deleted.is_(False), TimeEntry.end_at.is_not(None),
        TimeEntry.end_at > t).limit(1)).first()
    if last is not None:
        latest_end = db.session.scalar(db.select(db.func.max(TimeEntry.end_at)).where(
            TimeEntry.user_id == user.id, TimeEntry.is_deleted.is_(False)))
        latest_end = latest_end.replace(tzinfo=t.tzinfo) if latest_end and latest_end.tzinfo is None else latest_end
        if latest_end is not None and latest_end - t <= timedelta(seconds=5) and last.start_at <= t:
            t = latest_end  # rapid clicks: previous entry was kept >= 1 s long
        else:
            raise Conflict("Clock time overlaps an existing entry", code="overlap",
                           fields={"overlaps": serialize(last)})
    e = TimeEntry(user_id=user.id, kind=kind, start_at=t, end_at=None, tz=user.timezone,
                  source="clock" if source == "web" else source, created_by_id=user.id)
    db.session.add(e)
    backdated = utcnow() - t > BACKDATE_NOTE_AFTER
    revisions.record(obj=e, action="create", actor=user, subject_user_id=user.id, before=None, source=source,
                     reason="offline sync: clocked with an earlier time" if backdated else "")
    return e


def _close(user: User, e: TimeEntry, t: datetime, source: str, reason: str | None = None) -> datetime:
    """Close the open entry at ``t``; returns the effective end (next entry starts there)."""
    ensure_unlocked(user, t)
    backdated = utcnow() - t > BACKDATE_NOTE_AFTER
    before = revisions.snapshot(e)
    if t <= e.start_at:  # start and stop within the same second
        t = e.start_at + timedelta(seconds=1)
    if t - e.start_at > MAX_ENTRY:
        current_app.logger.info("Clock entry %s exceeded 24h; closing at start+24h", e.id)
        t = e.start_at + MAX_ENTRY
    e.end_at = t
    e.scheduled_end_at = None
    if source == "manual":  # end time chosen by hand ("clock out at a custom time"): shown as manual, not as a punch
        e.source = "manual"
    revisions.record(obj=e, action="update", actor=user, subject_user_id=user.id, before=before,
                     reason=reason or ("clock (offline sync: earlier time)" if backdated else "clock"), source=source)
    return t


def _schedule_stop(user: User, e: TimeEntry, at: datetime, source: str) -> None:
    """"Clock out later": the entry stays open and is closed at ``at`` by :func:`close_due_scheduled`."""
    at = at.replace(microsecond=0)
    if at - e.start_at > MAX_ENTRY:
        raise Validation("A clock-out can be scheduled at most 24 hours after the clock-in", fields={"at": "too_late"})
    ensure_unlocked(user, at)
    before = revisions.snapshot(e)
    e.scheduled_end_at = at
    local = at.astimezone(zone(user.timezone)).strftime("%H:%M")
    revisions.record(obj=e, action="update", actor=user, subject_user_id=user.id, before=before,
                     reason=f"clock-out scheduled for {local}", source=source)


def _unschedule_stop(user: User, e: TimeEntry, source: str) -> None:
    before = revisions.snapshot(e)
    e.scheduled_end_at = None
    revisions.record(obj=e, action="update", actor=user, subject_user_id=user.id, before=before,
                     reason="scheduled clock-out cancelled", source=source)


def close_due_scheduled(user: User | None = None) -> int:
    """Close the open entries whose scheduled clock-out time has passed, at exactly that time. The worker
    runs this every minute; every clock request runs it for its user first, so a stopped worker never
    leaves someone clocked in beyond the time they chose. Commits; returns the number of closed entries."""
    now = utcnow()
    q = db.select(TimeEntry).where(TimeEntry.end_at.is_(None), TimeEntry.is_deleted.is_(False),
                                   TimeEntry.scheduled_end_at.is_not(None), TimeEntry.scheduled_end_at <= now)
    if user is not None:
        q = q.where(TimeEntry.user_id == user.id)
    closed = 0
    for e in db.session.scalars(q).all():
        owner = user if user is not None else db.session.get(User, e.user_id)
        try:
            _close(owner, e, e.scheduled_end_at, "manual", reason="clock (scheduled clock-out)")
            db.session.commit()
            closed += 1
        except Exception:  # noqa: BLE001 - e.g. the month was signed off meanwhile: leave the entry to the person
            current_app.logger.exception("Scheduled clock-out of entry %s failed", e.id)
            db.session.rollback()
    return closed


def clock_action(user: User, action: str, at: datetime | None = None, source: str = "web",
                 note: str = "") -> dict[str, Any]:
    """``start``, ``stop`` and ``unschedule``. A ``stop`` with a future ``at`` does not close the entry but
    schedules the clock-out ("clock out later"); ``unschedule`` drops such a plan. Idempotent: repeated
    clicks and retried offline requests change nothing."""
    if action not in ("start", "stop", "unschedule"):
        raise Validation("Unknown clock action", fields={"action": "invalid"})
    close_due_scheduled(user)
    current = open_entry(user)
    if action == "unschedule":
        if current is not None and current.scheduled_end_at is not None:
            _unschedule_stop(user, current, source)
    elif action == "start":
        if current is None:
            e = _start_new(user, "work", _clock_time(at, None), source)
            if note:
                e.note = note[:500]
    elif current is not None:  # stop
        if at is not None and at > utcnow() + FUTURE_TOLERANCE:
            _schedule_stop(user, current, at, source)
        else:
            _close(user, current, _clock_time(at, current), source)
    db.session.flush()
    return clock_state(user)
