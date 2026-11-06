# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Absences: vacation workflow (request -> approve/reject -> cancel), sick notes, attachments."""

from __future__ import annotations

import hashlib
import secrets
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from flask import current_app
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from ..errors import Conflict, Forbidden, NotFound, Validation
from ..extensions import db
from ..models import (
    ABSENCE_ACTIVE_STATES,
    ABSENCE_APPROVED,
    ABSENCE_CANCELLED,
    ABSENCE_PENDING,
    ABSENCE_REJECTED,
    Absence,
    AbsenceType,
    Attachment,
    User,
)
from ..timeutil import daterange, iso, local_today, utcnow
from . import accounts, mail, notifications, permissions, revisions
from . import settings as settings_svc

DEFAULT_TYPES = [
    # key, label, color, category, credits_time, deducts_vacation, requires_approval, attachments, self
    ("vacation", "Vacation", "#35a1cc", "vacation", True, True, True, False, True),
    ("sick", "Sick", "#e0a23b", "sick", True, False, False, True, True),
    ("accident", "Accident", "#d9534f", "sick", True, False, False, True, False),
    ("child_sick", "Sick child care", "#e7b75f", "sick", True, False, False, True, True),
    ("military", "Military / civil service", "#7a8b5c", "other", True, False, True, True, True),
    ("training", "Training", "#8f7ad1", "other", True, False, True, False, True),
    ("comp_time", "Time off in lieu", "#61cae2", "other", False, False, True, False, True),
    ("special", "Special leave", "#b07ad1", "other", True, False, True, False, True),
    ("unpaid", "Unpaid leave", "#62656b", "other", True, False, True, False, True),
]

ALLOWED_UPLOADS = {
    "application/pdf": (b"%PDF-",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/webp": (b"RIFF",),
    "image/heic": (b"ftypheic", b"ftypheix", b"ftypmif1", b"ftyphevc"),
}


def seed_types() -> None:
    existing = set(db.session.scalars(db.select(AbsenceType.key)))
    for i, (key, label, color, cat, credits, deducts, approval, att, self_) in enumerate(DEFAULT_TYPES):
        if key in existing:
            continue
        db.session.add(AbsenceType(key=key, label=label, color=color, category=cat, credits_time=credits,
                                   deducts_vacation=deducts, requires_approval=approval,
                                   allows_attachments=att, employee_can_request=self_, sort=i * 10))
    db.session.flush()


def get_type(type_ref: int | str) -> AbsenceType:
    if isinstance(type_ref, int) or (isinstance(type_ref, str) and type_ref.isdigit()):
        t = db.session.get(AbsenceType, int(type_ref))
    else:
        t = db.session.scalar(db.select(AbsenceType).where(AbsenceType.key == type_ref))
    if t is None or not t.is_active:
        raise Validation("Unknown absence type", fields={"type": "invalid"})
    return t


def get_absence(absence_id: int) -> Absence:
    a = db.session.get(Absence, absence_id)
    if a is None:
        raise NotFound("Absence not found")
    return a


# --------------------------------------------------------------------------- validation

def _validate_halves(start: date, end: date, start_half: str, end_half: str) -> None:
    if end < start:
        raise Validation("End date is before start date", fields={"end_date": "before_start"})
    if (end - start).days > 366:
        raise Validation("An absence cannot be longer than a year", fields={"end_date": "too_long"})
    if start == end:
        if start_half not in ("full", "am", "pm"):
            raise Validation("Invalid half-day", fields={"start_half": "invalid"})
    else:
        if start_half not in ("full", "pm"):
            raise Validation("A multi-day absence can only start in the afternoon",
                             fields={"start_half": "invalid"})
        if end_half not in ("full", "am"):
            raise Validation("A multi-day absence can only end at noon", fields={"end_half": "invalid"})


def _probe(user_id: int, start: date, end: date, sh: str, eh: str) -> Absence:
    return Absence(user_id=user_id, type_id=0, start_date=start, end_date=end, start_half=sh,
                   end_half=eh if start != end else "full")


def _check_overlap(user: User, start: date, end: date, sh: str, eh: str, exclude_id: int | None = None) -> None:
    probe = _probe(user.id, start, end, sh, eh)
    q = db.select(Absence).where(Absence.user_id == user.id, Absence.status.in_(ABSENCE_ACTIVE_STATES),
                                 Absence.start_date <= end, Absence.end_date >= start)
    if exclude_id:
        q = q.where(Absence.id != exclude_id)
    for other in db.session.scalars(q):
        for d in daterange(max(start, other.start_date), min(end, other.end_date)):
            if accounts.absence_halves(probe, d) & accounts.absence_halves(other, d):
                t = db.session.get(AbsenceType, other.type_id)
                raise Conflict(f"Overlaps an existing absence ({t.label if t else ''}, "
                               f"{other.start_date.isoformat()} – {other.end_date.isoformat()})",
                               code="absence_overlap", fields={"overlaps": other.id})


def _check_locks(start: date, end: date, owner: User | None = None) -> None:
    """Signed-off months are read-only (see services.signoffs)."""
    if owner is not None:
        from . import signoffs

        signoffs.ensure_open_dates(owner, start, end)


def self_sick_allowed(user: User, d: date | None = None) -> dict[str, Any]:
    """Whether ``user`` may report sick for day ``d`` (default today). Returns {allowed, reason}."""
    d = d or local_today(user.timezone)
    ctx = accounts.load_context(user, d, d, include_pending=False)
    sched = accounts.schedule_for(ctx.schedules, d)
    if not accounts._employed(user, d) or not sched or sched.minutes_for(d) <= 0:
        return {"allowed": False, "reason": "not_a_workday"}
    h = ctx.holidays.get(d)
    if h and h.fraction >= 1.0:
        return {"allowed": False, "reason": "public_holiday"}
    for a in ctx.absences:
        t = ctx.types.get(a.type_id)
        if a.status == ABSENCE_APPROVED and accounts.absence_halves(a, d):
            return {"allowed": False, "reason": "already_sick" if t and t.category == "sick" else "on_vacation"}
    return {"allowed": True, "reason": None}


# --------------------------------------------------------------------------- create / update

def create(actor: User, owner: User, *, type_ref: int | str, start_date: date, end_date: date | None,
           start_half: str = "full", end_half: str = "full", note: str = "", source: str = "web") -> Absence:
    end_date = end_date or start_date
    t = get_type(type_ref)
    is_self = actor.id == owner.id
    manager = permissions.can_manage_user(actor, owner)
    if not is_self and not manager:
        raise Forbidden("You can only record absences for members of teams you lead")
    if is_self and not t.employee_can_request and not actor.is_hr:
        raise Forbidden(f"'{t.label}' can only be recorded by your team lead or an administrator")
    if start_date == end_date:
        end_half = "full"
    _validate_halves(start_date, end_date, start_half, end_half)

    today = local_today(owner.timezone)
    if t.category == "sick" and is_self and not actor.is_hr:
        backdate = int(settings_svc.get("sick_self_report_backdate_days"))
        max_days = int(settings_svc.get("sick_self_report_max_days"))
        if start_date > today:
            raise Validation("You can't report sick in advance", fields={"start_date": "future"})
        if start_date < today - timedelta(days=backdate):
            raise Validation(f"Sick reports can be backdated by at most {backdate} days; "
                             "please ask your team lead", fields={"start_date": "too_old"})
        if (end_date - start_date).days + 1 > max_days:
            raise Validation(f"A sick report can cover at most {max_days} days", fields={"end_date": "too_long"})
        check = self_sick_allowed(owner, start_date)
        if not check["allowed"]:
            messages = {"not_a_workday": "This is not one of your working days",
                        "public_holiday": "This day is a public holiday",
                        "on_vacation": "You are on vacation on this day",
                        "already_sick": "You are already reported sick on this day"}
            raise Conflict(messages[check["reason"]], code=check["reason"])

    _check_locks(start_date, end_date, owner)
    _check_overlap(owner, start_date, end_date, start_half, end_half)
    days = accounts.count_absence_days(owner, start_date, end_date, start_half, end_half)
    if days <= 0:
        raise Validation("The selected period contains no working days", fields={"end_date": "no_workdays"})

    a = Absence(user_id=owner.id, type_id=t.id, start_date=start_date, end_date=end_date,
                start_half=start_half, end_half=end_half if start_date != end_date else "full",
                note=note.strip()[:1000], requested_by_id=actor.id)
    needs_approval = t.requires_approval and is_self and not actor.is_hr
    if needs_approval:
        a.status = ABSENCE_PENDING
    else:
        a.status = ABSENCE_APPROVED
        a.decided_by_id = actor.id
        a.decided_at = utcnow()
    db.session.add(a)
    revisions.record(obj=a, action="create", actor=actor, subject_user_id=owner.id, before=None,
                     source=source)
    db.session.flush()

    if needs_approval:
        for approver in permissions.approvers_for(owner):
            notifications.notify(approver, "absence_requested", absence_id=a.id, user_id=owner.id,
                                 user_name=owner.name, type=t.label, type_key=t.key, start_date=start_date.isoformat(),
                                 end_date=end_date.isoformat(), days=days)
            mail.send(mail.build("absence_requested", approver.email, approver.locale, user=approver,
                                 requester=owner, absence=a, type=t, days=days))
    elif is_self:
        # Self-reported sickness etc.: inform the lead / admins (never the person themselves).
        for approver in (a_ for a_ in permissions.approvers_for(owner) if a_.id != owner.id):
            notifications.notify(approver, "absence_reported", absence_id=a.id, user_id=owner.id,
                                 user_name=owner.name, type=t.label, type_key=t.key, start_date=start_date.isoformat(),
                                 end_date=end_date.isoformat(), days=days)
            mail.send(mail.build("absence_reported", approver.email, approver.locale, user=approver,
                                 requester=owner, absence=a, type=t, days=days))
    else:
        notifications.notify(owner, "absence_recorded", absence_id=a.id, actor_name=actor.name,
                             type=t.label, type_key=t.key, start_date=start_date.isoformat(), end_date=end_date.isoformat())
        mail.send(mail.build("absence_recorded", owner.email, owner.locale, user=owner, actor=actor,
                             absence=a, type=t, days=days))
    return a


def update(actor: User, a: Absence, changes: dict[str, Any], reason: str = "", source: str = "web") -> Absence:
    owner = db.session.get(User, a.user_id)
    t = db.session.get(AbsenceType, a.type_id)
    is_self = actor.id == owner.id
    manager = permissions.can_manage_user(actor, owner)
    if a.status not in ABSENCE_ACTIVE_STATES:
        raise Conflict("Only pending or approved absences can be changed", code="invalid_state")
    if not manager:
        if not is_self:
            raise Forbidden("Not allowed")
        own_sick = t.category == "sick" and a.requested_by_id == owner.id
        if a.status != ABSENCE_PENDING and not own_sick:
            raise Forbidden("Approved absences can only be changed by your team lead; cancel it instead")
    if not is_self and not reason.strip():
        raise Validation("Please give a reason for this change", fields={"reason": "required"})
    before = revisions.snapshot(a)
    start = changes.get("start_date", a.start_date)
    end = changes.get("end_date", a.end_date)
    sh = changes.get("start_half", a.start_half)
    eh = changes.get("end_half", a.end_half)
    if start == end:
        eh = "full"
    _validate_halves(start, end, sh, eh)
    if is_self and not manager and t.category == "sick" and a.status == ABSENCE_APPROVED:
        max_days = int(settings_svc.get("sick_self_report_max_days"))
        if start != a.start_date:
            raise Forbidden("The start of a sick report can only be changed by your team lead")
        if (end - start).days + 1 > max_days:
            raise Validation(f"A sick report can cover at most {max_days} days", fields={"end_date": "too_long"})
    _check_locks(min(start, a.start_date), max(end, a.end_date), owner)
    _check_overlap(owner, start, end, sh, eh, exclude_id=a.id)
    if accounts.count_absence_days(owner, start, end, sh, eh) <= 0:
        raise Validation("The selected period contains no working days", fields={"end_date": "no_workdays"})
    a.start_date, a.end_date, a.start_half, a.end_half = start, end, sh, eh
    if "note" in changes:
        a.note = (changes["note"] or "").strip()[:1000]
    if revisions.snapshot(a) == before:
        return a
    revisions.record(obj=a, action="update", actor=actor, subject_user_id=owner.id, before=before,
                     reason=reason, source=source)
    if not is_self:
        notifications.notify(owner, "absence_changed", absence_id=a.id, actor_name=actor.name,
                             type=t.label, type_key=t.key, reason=reason, start_date=start.isoformat(), end_date=end.isoformat())
    return a


# --------------------------------------------------------------------------- workflow

def decide(actor: User, a: Absence, approve: bool, note: str = "", source: str = "web") -> Absence:
    owner = db.session.get(User, a.user_id)
    if a.status != ABSENCE_PENDING:
        raise Conflict("This request has already been decided", code="invalid_state")
    if not permissions.can_decide_absence(actor, owner):
        raise Forbidden("Only the team lead or an administrator can decide this request")
    if actor.id == owner.id and not actor.is_hr:
        raise Forbidden("You cannot approve your own request")
    _check_locks(a.start_date, a.end_date, owner)
    if approve:
        _check_overlap(owner, a.start_date, a.end_date, a.start_half, a.end_half, exclude_id=a.id)
    before = revisions.snapshot(a)
    a.status = ABSENCE_APPROVED if approve else ABSENCE_REJECTED
    a.decided_by_id = actor.id
    a.decided_at = utcnow()
    a.decision_note = note.strip()[:1000]
    revisions.record(obj=a, action="approve" if approve else "reject", actor=actor, subject_user_id=owner.id,
                     before=before, reason=note, source=source)
    t = db.session.get(AbsenceType, a.type_id)
    kind = "absence_approved" if approve else "absence_rejected"
    notifications.notify(owner, kind, absence_id=a.id, actor_name=actor.name, type=t.label, type_key=t.key,
                         start_date=a.start_date.isoformat(), end_date=a.end_date.isoformat(), note=note)
    mail.send(mail.build(kind, owner.email, owner.locale, user=owner, actor=actor, absence=a, type=t,
                         note=note, days=accounts.count_absence_days(owner, a.start_date, a.end_date,
                                                                     a.start_half, a.end_half)))
    return a


def can_cancel(actor: User, a: Absence) -> bool:
    owner = db.session.get(User, a.user_id)
    if a.status not in ABSENCE_ACTIVE_STATES:
        return False
    if permissions.can_manage_user(actor, owner):
        return True
    if actor.id != owner.id:
        return False
    if a.status == ABSENCE_PENDING:
        return True
    t = db.session.get(AbsenceType, a.type_id)
    today = local_today(owner.timezone)
    if t.category == "sick" and a.requested_by_id == owner.id:
        return a.start_date >= today - timedelta(days=int(settings_svc.get("sick_self_report_backdate_days")))
    return a.start_date > today


def cancel(actor: User, a: Absence, reason: str = "", source: str = "web") -> Absence:
    owner = db.session.get(User, a.user_id)
    if a.status not in ABSENCE_ACTIVE_STATES:
        raise Conflict("This absence is already closed", code="invalid_state")
    if not can_cancel(actor, a):
        raise Forbidden("Approved absences that have already started can only be cancelled by your team lead")
    if actor.id != owner.id and not reason.strip():
        raise Validation("Please give a reason for the cancellation", fields={"reason": "required"})
    _check_locks(a.start_date, a.end_date, owner)
    before = revisions.snapshot(a)
    was = a.status
    a.status = ABSENCE_CANCELLED
    a.cancelled_by_id = actor.id
    a.cancelled_at = utcnow()
    a.cancel_reason = reason.strip()[:1000]
    revisions.record(obj=a, action="cancel", actor=actor, subject_user_id=owner.id, before=before,
                     reason=reason, source=source)
    t = db.session.get(AbsenceType, a.type_id)
    if actor.id == owner.id:
        if was == ABSENCE_APPROVED or t.requires_approval:
            for approver in permissions.approvers_for(owner):
                notifications.notify(approver, "absence_cancelled", absence_id=a.id, user_id=owner.id,
                                     user_name=owner.name, actor_name=actor.name, type=t.label, type_key=t.key,
                                     start_date=a.start_date.isoformat(), end_date=a.end_date.isoformat())
    else:
        notifications.notify(owner, "absence_cancelled", absence_id=a.id, user_id=owner.id,
                             user_name=owner.name, actor_name=actor.name, type=t.label, type_key=t.key, reason=reason,
                             start_date=a.start_date.isoformat(), end_date=a.end_date.isoformat())
        mail.send(mail.build("absence_cancelled", owner.email, owner.locale, user=owner, actor=actor,
                             absence=a, type=t, reason=reason))
    return a


# --------------------------------------------------------------------------- queries

def list_for_users(user_ids: list[int] | None, start: date, end: date,
                   statuses: tuple[str, ...] | None = None) -> list[Absence]:
    q = db.select(Absence).where(Absence.start_date <= end, Absence.end_date >= start)
    if user_ids is not None:
        q = q.where(Absence.user_id.in_(user_ids))
    if statuses:
        q = q.where(Absence.status.in_(statuses))
    return list(db.session.scalars(q.order_by(Absence.start_date, Absence.id)))


def pending_for_approver(actor: User) -> list[Absence]:
    """Requests waiting for this person: HR sees all (except own); leads their teams; administrators
    only those nobody else can decide (team without active leads while no HR person exists)."""
    q = db.select(Absence).join(User, User.id == Absence.user_id).where(
        Absence.status == ABSENCE_PENDING, User.is_active.is_(True), User.id != actor.id)
    if actor.is_hr:
        return list(db.session.scalars(q.order_by(Absence.start_date)))
    teams = permissions.led_team_ids(actor)
    rows = list(db.session.scalars(q.where(User.team_id.in_(teams)).order_by(Absence.start_date))) if teams else []
    if actor.is_admin and not permissions.hr_users():
        for a in db.session.scalars(q.order_by(Absence.start_date)):
            if a not in rows and actor in permissions.approvers_for(a.user):
                rows.append(a)
    return rows


def serialize_type(t: AbsenceType) -> dict[str, Any]:
    return {"id": t.id, "key": t.key, "label": t.label, "color": t.color, "category": t.category,
            "credits_time": t.credits_time, "deducts_vacation": t.deducts_vacation,
            "requires_approval": t.requires_approval, "allows_attachments": t.allows_attachments,
            "employee_can_request": t.employee_can_request, "is_active": t.is_active, "sort": t.sort}


def serialize(a: Absence, actor: User | None = None) -> dict[str, Any]:
    owner = a.user
    data = {
        "id": a.id, "user": {"id": owner.id, "name": owner.name, "team_id": owner.team_id},
        "type": serialize_type(a.type), "start_date": a.start_date.isoformat(),
        "end_date": a.end_date.isoformat(), "start_half": a.start_half, "end_half": a.end_half,
        "days": accounts.count_absence_days(owner, a.start_date, a.end_date, a.start_half, a.end_half),
        "note": a.note, "status": a.status,
        "requested_by": {"id": a.requested_by.id, "name": a.requested_by.name} if a.requested_by else None,
        "decided_by": {"id": a.decided_by.id, "name": a.decided_by.name} if a.decided_by else None,
        "decided_at": iso(a.decided_at), "decision_note": a.decision_note,
        "cancelled_by": {"id": a.cancelled_by.id, "name": a.cancelled_by.name} if a.cancelled_by else None,
        "cancelled_at": iso(a.cancelled_at), "cancel_reason": a.cancel_reason,
        "attachments": [serialize_attachment(x) for x in a.attachments],
        "created_at": iso(a.created_at),
    }
    if actor is not None:
        manager = permissions.can_manage_user(actor, owner)
        data["permissions"] = {
            "cancel": can_cancel(actor, a),
            "decide": a.status == ABSENCE_PENDING and permissions.can_decide_absence(actor, owner)
            and (actor.id != owner.id or actor.is_hr),
            "edit": a.status in ABSENCE_ACTIVE_STATES and (manager or (
                actor.id == owner.id and (a.status == ABSENCE_PENDING or (
                    a.type.category == "sick" and a.requested_by_id == owner.id)))),
            "attach": a.type.allows_attachments and a.status in ABSENCE_ACTIVE_STATES
            and (manager or actor.id == owner.id),
        }
    return data


# --------------------------------------------------------------------------- attachments

def attachments_dir() -> Path:
    p = Path(current_app.config["DATA_DIR"]) / "attachments"
    p.mkdir(parents=True, exist_ok=True)
    return p


def purge_attachments(older_than_days: int, dry_run: bool = False) -> int:
    """Remove the files of soft-deleted documents, and of documents on cancelled/rejected absences,
    once they are older than ``older_than_days``. Rows are kept (marked purged) for the audit trail."""
    cutoff = utcnow() - timedelta(days=older_than_days)
    rows = db.session.scalars(db.select(Attachment).join(Absence, Absence.id == Attachment.absence_id).where(
        Attachment.created_at < cutoff, Attachment.size > 0,
        db.or_(Attachment.is_deleted.is_(True), Absence.status.in_(("cancelled", "rejected")))))
    removed = 0
    for att in rows:
        path = attachments_dir() / att.storage_name
        if not dry_run:
            if path.exists():
                path.unlink()
            att.is_deleted = True
            att.size = 0  # marks "file purged" while sha256 stays for the record
        removed += 1
    return removed


def _sniff(head: bytes) -> str | None:
    for ctype, sigs in ALLOWED_UPLOADS.items():
        for sig in sigs:
            if ctype == "image/heic":
                if head[4:12] == sig:
                    return ctype
            elif ctype == "image/webp":
                if head.startswith(sig) and head[8:12] == b"WEBP":
                    return ctype
            elif head.startswith(sig):
                return ctype
    return None


def add_attachment(actor: User, a: Absence, upload: FileStorage) -> Attachment:
    owner = db.session.get(User, a.user_id)
    if actor.id != owner.id and not permissions.can_manage_user(actor, owner):
        raise Forbidden("Not allowed")
    t = db.session.get(AbsenceType, a.type_id)
    if not t.allows_attachments:
        raise Validation(f"Attachments are not available for '{t.label}'", fields={"file": "not_allowed"})
    if a.status not in ABSENCE_ACTIVE_STATES:
        raise Conflict("This absence is closed", code="invalid_state")
    data = upload.read()
    max_bytes = int(current_app.config["ATTACHMENT_MAX_MB"]) * 1024 * 1024
    if not data:
        raise Validation("The file is empty", fields={"file": "empty"})
    if len(data) > max_bytes:
        raise Validation(f"The file is larger than {current_app.config['ATTACHMENT_MAX_MB']} MB",
                         fields={"file": "too_large"})
    ctype = _sniff(data[:16])
    if ctype is None:
        raise Validation("Only PDF, PNG, JPEG, WebP or HEIC files are allowed", fields={"file": "type"})
    count = db.session.scalar(db.select(db.func.count(Attachment.id)).where(
        Attachment.absence_id == a.id, Attachment.is_deleted.is_(False))) or 0
    if count >= 10:
        raise Validation("At most 10 attachments per absence", fields={"file": "too_many"})
    storage_name = secrets.token_hex(16)
    (attachments_dir() / storage_name).write_bytes(data)
    name = secure_filename(upload.filename or "") or f"attachment.{ctype.split('/')[1]}"
    att = Attachment(absence_id=a.id, filename=name[:255], content_type=ctype, size=len(data),
                     sha256=hashlib.sha256(data).hexdigest(), storage_name=storage_name,
                     uploaded_by_id=actor.id)
    db.session.add(att)
    revisions.record(obj=att, action="create", actor=actor, subject_user_id=owner.id, before=None)
    if actor.id != owner.id:
        notifications.notify(owner, "attachment_added", absence_id=a.id, actor_name=actor.name,
                             filename=att.filename)
    return att


def get_attachment(actor: User, attachment_id: int) -> tuple[Attachment, Path]:
    att = db.session.get(Attachment, attachment_id)
    if att is None or att.is_deleted:
        raise NotFound("Attachment not found")
    a = db.session.get(Absence, att.absence_id)
    owner = db.session.get(User, a.user_id)
    if not permissions.can_view_user(actor, owner):
        raise NotFound("Attachment not found")
    path = attachments_dir() / att.storage_name
    if not path.exists():
        raise NotFound("Attachment file is missing")
    return att, path


def delete_attachment(actor: User, attachment_id: int) -> None:
    att, path = get_attachment(actor, attachment_id)
    a = db.session.get(Absence, att.absence_id)
    owner = db.session.get(User, a.user_id)
    if not (actor.is_hr or att.uploaded_by_id == actor.id or permissions.can_manage_user(actor, owner)):
        raise Forbidden("Not allowed")
    before = revisions.snapshot(att)
    att.is_deleted = True
    revisions.record(obj=att, action="delete", actor=actor, subject_user_id=owner.id, before=before)
    # The file is kept (soft delete) so the audit trail stays complete; admins can purge via CLI.


def serialize_attachment(att: Attachment) -> dict[str, Any]:
    return {"id": att.id, "filename": att.filename, "content_type": att.content_type, "size": att.size,
            "uploaded_by_id": att.uploaded_by_id, "created_at": iso(att.created_at),
            "url": f"/api/v1/attachments/{att.id}"}

