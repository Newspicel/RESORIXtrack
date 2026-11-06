# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Monthly sign-off of an employee's time data by a team lead or administrator.

Once signed off, the month is immutable for everyone until an administrator reopens it (with a logged
reason). Protection layers:

1. API/services: every write path calls ``ensure_open_*`` (this module).
2. Database: SQLite triggers reject writes into signed periods (``resorixtrack.db_guards``).
3. Tamper evidence: ``digest`` fingerprints all time data of the period at sign-off time and
   ``seal`` = HMAC-SHA256(server key, sign-off record + previous seal) forms a per-user chain.
   ``verify`` detects edits made directly in the database file, forged and removed sign-offs.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import date, datetime, timedelta
from typing import Any

from flask import current_app

from ..errors import Conflict, Forbidden, NotFound, Validation
from ..extensions import db
from ..models import (
    ABSENCE_PENDING,
    Absence,
    BalanceAdjustment,
    MonthSignoff,
    TimeEntry,
    User,
    WorkLog,
)
from ..timeutil import day_bounds_utc, iso, local_today, month_bounds, utcnow, zone
from . import accounts, notifications, permissions

MONTH_FMT = "%Y-%m"


# --------------------------------------------------------------------------- lock checks

def _active(user_id: int):
    return db.select(MonthSignoff).where(MonthSignoff.user_id == user_id, MonthSignoff.reopened_at.is_(None))


def signed_months_overlapping(user_id: int, start: date, end: date) -> list[MonthSignoff]:
    return list(db.session.scalars(_active(user_id).where(
        MonthSignoff.period_start_date <= end, MonthSignoff.period_end_date >= start)
        .order_by(MonthSignoff.month)))


def _raise(rows: list[MonthSignoff]) -> None:
    months = ", ".join(r.month for r in rows)
    by = rows[0].signed_by.name if rows[0].signed_by else "?"
    raise Conflict(f"{months} has been signed off by {by} and can no longer be changed. "
                   "An administrator can reopen the month.", code="period_signed_off",
                   fields={"months": [r.month for r in rows]})


def ensure_open_instants(user: User, *dts: datetime | None) -> None:
    days = [dt.astimezone(zone(user.timezone)).date() for dt in dts if dt is not None]
    if days:
        rows = signed_months_overlapping(user.id, min(days), max(days))
        if rows:
            _raise(rows)


def ensure_open_dates(user: User, start: date, end: date | None = None) -> None:
    rows = signed_months_overlapping(user.id, start, end or start)
    if rows:
        _raise(rows)


def ensure_schedule_change_allowed(user: User, valid_from: date) -> None:
    rows = list(db.session.scalars(_active(user.id).where(MonthSignoff.period_end_date >= valid_from)
                                   .order_by(MonthSignoff.month)))
    if rows:
        raise Conflict(f"A schedule starting {valid_from.isoformat()} would change the signed-off month(s) "
                       f"{', '.join(r.month for r in rows)}. Choose a date after the last signed-off month.",
                       code="period_signed_off", fields={"valid_from": "signed_off"})


def latest_signed_date() -> date | None:
    return db.session.scalar(db.select(db.func.max(MonthSignoff.period_end_date))
                             .where(MonthSignoff.reopened_at.is_(None)))


def ensure_holiday_change_allowed(d: date) -> None:
    latest = latest_signed_date()
    if latest is not None and d <= latest:
        raise Conflict(f"Holidays on or before {latest.isoformat()} belong to signed-off months and can no "
                       "longer be changed.", code="period_signed_off", fields={"date": "signed_off"})


def locked_months(user: User, start: date, end: date) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in signed_months_overlapping(user.id, start, end):
        out[r.month] = {"id": r.id, "signed_by": r.signed_by.name if r.signed_by else None,
                        "signed_at": iso(r.signed_at), "note": r.note}
    return out


# --------------------------------------------------------------------------- fingerprint + seal

def _key() -> bytes:
    key = current_app.config.get("SIGNOFF_KEY") or current_app.config["SECRET_KEY"]
    return hashlib.sha256(("resorixtrack-signoff:" + key).encode()).digest()


def _ts(v: datetime | None) -> str | None:
    return v.astimezone(zone("UTC")).strftime("%Y-%m-%dT%H:%M:%S.%f") if v else None


def period_data(user_id: int, start_date: date, end_date: date, start_utc: datetime, end_utc: datetime) -> dict:
    """All rows that make up the month (including soft-deleted ones), in canonical form."""
    entries = db.session.scalars(db.select(TimeEntry).where(
        TimeEntry.user_id == user_id, TimeEntry.start_at < end_utc,
        db.or_(TimeEntry.end_at.is_(None), TimeEntry.end_at > start_utc)).order_by(TimeEntry.id))
    absences = db.session.scalars(db.select(Absence).where(
        Absence.user_id == user_id, Absence.start_date <= end_date, Absence.end_date >= start_date)
        .order_by(Absence.id))
    adjustments = db.session.scalars(db.select(BalanceAdjustment).where(
        BalanceAdjustment.user_id == user_id, BalanceAdjustment.effective_date >= start_date,
        BalanceAdjustment.effective_date <= end_date).order_by(BalanceAdjustment.id))
    logs = db.session.scalars(db.select(WorkLog).where(
        WorkLog.user_id == user_id, WorkLog.date >= start_date, WorkLog.date <= end_date).order_by(WorkLog.id))
    return {
        "work_logs": [[w.id, w.date.isoformat(), w.project_id, w.customer_ref, int(w.minutes), w.note, bool(w.is_deleted),
                       w.start_time.strftime("%H:%M") if w.start_time else None, w.end_time.strftime("%H:%M") if w.end_time else None] for w in logs],
        "entries": [[e.id, e.kind, _ts(e.start_at), _ts(e.end_at), bool(e.is_deleted), e.note] for e in entries],
        "absences": [[a.id, a.type_id, a.start_date.isoformat(), a.end_date.isoformat(), a.start_half,
                      a.end_half, a.status] for a in absences],
        "adjustments": [[a.id, a.account, float(a.amount), a.effective_date.isoformat(), bool(a.is_deleted)]
                        for a in adjustments],
    }


def compute_digest(data: dict) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def compute_seal(row: MonthSignoff) -> str:
    payload = {
        "user_id": row.user_id, "month": row.month, "start": row.period_start_date.isoformat(),
        "end": row.period_end_date.isoformat(), "start_utc": _ts(row.period_start_utc),
        "end_utc": _ts(row.period_end_utc), "signed_by": row.signed_by_id, "signed_at": _ts(row.signed_at),
        "snapshot": row.snapshot, "digest": row.digest, "prev": row.prev_seal,
    }
    msg = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hmac.new(_key(), msg, hashlib.sha256).hexdigest()


# --------------------------------------------------------------------------- sign off / reopen

def parse_month(month: str) -> tuple[int, int]:
    try:
        d = datetime.strptime(month, MONTH_FMT)
    except ValueError as exc:
        raise Validation("Month must be YYYY-MM", fields={"month": "invalid"}) from exc
    return d.year, d.month


def can_sign(actor: User, target: User) -> bool:
    """Leads/deputies sign their members; HR signs anyone except themselves. Never one's own month."""
    if actor.id == target.id:
        return False
    return actor.is_hr or permissions.leads_user(actor, target)


def blockers(user: User, month: str) -> list[str]:
    year, mon = parse_month(month)
    start, end = month_bounds(year, mon)
    out = []
    if end >= local_today(user.timezone):
        out.append("month_not_complete")
    e_utc = day_bounds_utc(end, user.timezone)[1]
    running = db.session.scalar(db.select(TimeEntry.id).where(
        TimeEntry.user_id == user.id, TimeEntry.end_at.is_(None), TimeEntry.is_deleted.is_(False),
        TimeEntry.start_at < e_utc).limit(1))
    if running:
        out.append("running_entry")
    pending = db.session.scalar(db.select(Absence.id).where(
        Absence.user_id == user.id, Absence.status == ABSENCE_PENDING, Absence.start_date <= end,
        Absence.end_date >= start).limit(1))
    if pending:
        out.append("pending_absence")
    if db.session.scalar(_active(user.id).where(MonthSignoff.month == month).limit(1)):
        out.append("already_signed")
    if user.employment_start and end < user.employment_start:
        out.append("not_employed")
    from . import worklog

    if "month_not_complete" not in out and worklog.days_with_gaps(user, start, end):
        out.append("worklog_incomplete")
    return out


def sign_off(actor: User, user: User, month: str, note: str = "") -> MonthSignoff:
    if not can_sign(actor, user):
        if actor.id == user.id:
            raise Forbidden("Your own month must be signed off by another lead or by HR")
        raise Forbidden("You can only sign off members of teams you lead")
    problems = blockers(user, month)
    if problems:
        messages = {"month_not_complete": "The month is not over yet",
                    "running_entry": "There is a running time entry",
                    "pending_absence": "There are absence requests waiting for a decision",
                    "worklog_incomplete": "The work log does not cover the required share of the worked time",
                    "already_signed": "This month is already signed off",
                    "not_employed": "The person was not employed in this month"}
        raise Conflict("; ".join(messages[p] for p in problems), code=problems[0], fields={"blockers": problems})
    year, mon = parse_month(month)
    start, end = month_bounds(year, mon)
    s_utc, e_utc = day_bounds_utc(start, user.timezone)[0], day_bounds_utc(end, user.timezone)[1]
    ctx = accounts.load_context(user, start, end, include_pending=False)
    summary = accounts.summarize(accounts.compute_days(ctx))
    balance = accounts.time_balance(user, end)["balance_min"]
    snapshot = {**summary, "balance_end_min": balance, "timezone": user.timezone,
                "user_name": user.name, "signed_by_name": actor.name}
    prev = db.session.scalars(db.select(MonthSignoff).where(MonthSignoff.user_id == user.id)
                              .order_by(MonthSignoff.id.desc()).limit(1)).first()
    row = MonthSignoff(
        user_id=user.id, month=month, period_start_date=start, period_end_date=end,
        period_start_utc=s_utc, period_end_utc=e_utc, signed_by_id=actor.id,
        signed_at=utcnow().replace(microsecond=0), note=(note or "").strip()[:500], snapshot=snapshot,
        digest=compute_digest(period_data(user.id, start, end, s_utc, e_utc)), prev_seal=prev.seal if prev else "",
    )
    row.seal = compute_seal(row)
    db.session.add(row)
    db.session.flush()
    _log(actor, row, "signoff", note)
    if actor.id != user.id:
        notifications.notify(user, "month_signed_off", month=month, actor_name=actor.name, signoff_id=row.id)
    return row


def reopen(actor: User, row: MonthSignoff, reason: str) -> MonthSignoff:
    if not actor.is_hr:
        raise Forbidden("Only HR can reopen a signed-off month")
    if row.reopened_at is not None:
        raise Conflict("This sign-off was already reopened", code="invalid_state")
    if not (reason or "").strip():
        raise Validation("A reason is required", fields={"reason": "required"})
    row.reopened_at = utcnow()
    row.reopened_by_id = actor.id
    row.reopen_reason = reason.strip()[:500]
    _log(actor, row, "reopen", reason)
    user = db.session.get(User, row.user_id)
    signer = db.session.get(User, row.signed_by_id) if row.signed_by_id else None
    targets = {u.id: u for u in (user, signer) if u is not None}
    for target in targets.values():
        if target.id != actor.id:
            notifications.notify(target, "month_reopened", month=row.month, actor_name=actor.name,
                                 reason=reason.strip()[:500], user_name=user.name, user_id=user.id)
    return row


def _log(actor: User, row: MonthSignoff, action: str, reason: str) -> None:
    from ..models import Revision

    db.session.add(Revision(entity="signoff", entity_id=row.id, subject_user_id=row.user_id, actor_id=actor.id,
                            action=action, before=None,
                            after={"month": row.month, "digest": row.digest, "seal": row.seal},
                            reason=(reason or "").strip()[:500], source="web"))


def get(signoff_id: int) -> MonthSignoff:
    row = db.session.get(MonthSignoff, signoff_id)
    if row is None:
        raise NotFound("Sign-off not found")
    return row


# --------------------------------------------------------------------------- verification

FIGURE_KEYS = ("target_min", "worked_min", "delta_min")


def current_figures(user: User, r: MonthSignoff) -> dict[str, Any]:
    ctx = accounts.load_context(user, r.period_start_date, r.period_end_date, include_pending=False)
    return accounts.summarize(accounts.compute_days(ctx))


def verify_user(user_id: int) -> dict[int, str]:
    """Status per sign-off id: intact | figures_changed | data_changed | seal_invalid | chain_broken.

    ``figures_changed`` means the rows are untouched but a rule that feeds the calculation (holiday
    mode, calendar assignment, absence-type flags, ...) changed after the sign-off, so the month's
    live figures no longer match the signed snapshot.
    """
    rows = list(db.session.scalars(db.select(MonthSignoff).where(MonthSignoff.user_id == user_id)
                                   .order_by(MonthSignoff.id)))
    user = db.session.get(User, user_id)
    result: dict[int, str] = {}
    prev = ""
    for r in rows:
        if r.prev_seal != prev:
            result[r.id] = "chain_broken"
        elif not hmac.compare_digest(compute_seal(r), r.seal):
            result[r.id] = "seal_invalid"
        elif r.reopened_at is None and compute_digest(
                period_data(r.user_id, r.period_start_date, r.period_end_date, r.period_start_utc,
                            r.period_end_utc)) != r.digest:
            result[r.id] = "data_changed"
        elif r.reopened_at is None and user is not None and any(
                (r.snapshot or {}).get(k) is not None and current_figures(user, r).get(k) != r.snapshot.get(k)
                for k in FIGURE_KEYS):
            result[r.id] = "figures_changed"
        else:
            result[r.id] = "intact"
        prev = r.seal
    return result


def serialize(r: MonthSignoff, status: str | None = None) -> dict[str, Any]:
    return {
        "id": r.id, "user_id": r.user_id, "user_name": r.user.name if r.user else None, "month": r.month,
        "period_start": r.period_start_date.isoformat(), "period_end": r.period_end_date.isoformat(),
        "signed_by": {"id": r.signed_by.id, "name": r.signed_by.name} if r.signed_by else None,
        "signed_at": iso(r.signed_at), "note": r.note, "snapshot": r.snapshot, "digest": r.digest,
        "active": r.reopened_at is None, "reopened_at": iso(r.reopened_at),
        "reopened_by": {"id": r.reopened_by.id, "name": r.reopened_by.name} if r.reopened_by else None,
        "reopen_reason": r.reopen_reason, "integrity": status,
    }


def previous_month(user: User) -> str:
    first = local_today(user.timezone).replace(day=1)
    return (first - timedelta(days=1)).strftime(MONTH_FMT)
