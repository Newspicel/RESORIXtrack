# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Time and vacation accounts.

Each day is split into two halves (am / pm). Half-day public holidays cover the *afternoon*
(e.g. 24 Dec pm). Absences cover am, pm or both. This makes overlaps of half-day holidays and
half-day absences unambiguous.

Per day:
    scheduled        minutes from the versioned work schedule (0 outside employment period)
    holiday_credit   scheduled mode: scheduled x holiday halves / 2
                     pro-rata mode:  pensum x full-time daily minutes x holiday halves / 2 (Mon-Fri)
    absence_credit   scheduled x absence halves (not covered by holiday) / 2, for crediting types
    target           max(0, scheduled - holiday_credit - absence_credit)
    extra_credit     max(0, holiday_credit + absence_credit - scheduled)   (pro-rata only)
    delta            worked - target + extra_credit + surcharge
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from ..extensions import db
from ..models import (
    ABSENCE_APPROVED,
    ABSENCE_PENDING,
    WEEKDAYS,
    Absence,
    AbsenceType,
    BalanceAdjustment,
    Holiday,
    TimeEntry,
    User,
    VacationEntitlement,
    WorkLog,
    WorkSchedule,
)
from ..timeutil import daterange, day_bounds_utc, local_today, minutes_between, utcnow, zone
from . import settings as settings_svc

AM, PM = "am", "pm"


# --------------------------------------------------------------------------- helpers

def absence_halves(a: Absence, d: date) -> set[str]:
    """Which halves of day ``d`` the absence covers."""
    if d < a.start_date or d > a.end_date:
        return set()
    if a.start_date == a.end_date:
        return {AM, PM} if a.start_half == "full" else {a.start_half}
    if d == a.start_date:
        return {PM} if a.start_half == "pm" else {AM, PM}
    if d == a.end_date:
        return {AM} if a.end_half == "am" else {AM, PM}
    return {AM, PM}


def holiday_halves(fraction: float) -> set[str]:
    if fraction >= 1.0:
        return {AM, PM}
    if fraction > 0:
        return {PM}
    return set()


def resolve_calendar_id(user: User) -> int | None:
    """Personal assignment -> team calendar -> company default (see ``holidays.applicable_calendar``)."""
    from . import holidays as hol

    cal, _source = hol.applicable_calendar(user)
    return cal.id if cal is not None else None


def account_start(user: User) -> date:
    if user.employment_start:
        return user.employment_start
    first = db.session.scalar(db.select(db.func.min(WorkSchedule.valid_from))
                              .where(WorkSchedule.user_id == user.id))
    created = user.created_at.astimezone(zone(user.timezone)).date()
    return min(first, created) if first else created


# --------------------------------------------------------------------------- data context

@dataclass
class Context:
    user: User
    start: date
    end: date
    schedules: list[WorkSchedule]
    holidays: dict[date, Holiday]
    absences: list[Absence]
    types: dict[int, AbsenceType]
    entries: list[TimeEntry]
    settings: dict[str, Any]
    now: datetime
    worklog_minutes: dict[date, int] = field(default_factory=dict)


def load_context(user: User, start: date, end: date, *, include_pending: bool = True) -> Context:
    cal_id = resolve_calendar_id(user)
    holidays: dict[date, Holiday] = {}
    if cal_id:
        for h in db.session.scalars(db.select(Holiday).where(
                Holiday.calendar_id == cal_id, Holiday.date >= start, Holiday.date <= end)):
            holidays[h.date] = h
    states = (ABSENCE_APPROVED, ABSENCE_PENDING) if include_pending else (ABSENCE_APPROVED,)
    absences = list(db.session.scalars(db.select(Absence).where(
        Absence.user_id == user.id, Absence.status.in_(states),
        Absence.start_date <= end, Absence.end_date >= start)))
    types = {t.id: t for t in db.session.scalars(db.select(AbsenceType))}
    s_utc = day_bounds_utc(start, user.timezone)[0]
    e_utc = day_bounds_utc(end, user.timezone)[1]
    entries = list(db.session.scalars(db.select(TimeEntry).where(
        TimeEntry.user_id == user.id, TimeEntry.is_deleted.is_(False),
        TimeEntry.start_at < e_utc,
        db.or_(TimeEntry.end_at.is_(None), TimeEntry.end_at > s_utc),
    ).order_by(TimeEntry.start_at)))
    schedules = list(db.session.scalars(db.select(WorkSchedule).where(WorkSchedule.user_id == user.id)
                                        .order_by(WorkSchedule.valid_from)))
    worklog_minutes: dict[date, int] = {}
    for d_, m_ in db.session.execute(db.select(WorkLog.date, db.func.sum(WorkLog.minutes)).where(
            WorkLog.user_id == user.id, WorkLog.is_deleted.is_(False), WorkLog.date >= start, WorkLog.date <= end)
            .group_by(WorkLog.date)):
        worklog_minutes[d_] = int(m_ or 0)
    return Context(user=user, start=start, end=end, schedules=schedules, holidays=holidays,
                   absences=absences, types=types, entries=entries, settings=settings_svc.get_all(),
                   now=utcnow(), worklog_minutes=worklog_minutes)


def schedule_for(schedules: list[WorkSchedule], d: date) -> WorkSchedule | None:
    current = None
    for s in schedules:
        if s.valid_from <= d:
            current = s
        else:
            break
    return current


# --------------------------------------------------------------------------- day computation

@dataclass
class Day:
    date: str
    weekday: int
    scheduled_min: float = 0
    holiday: dict[str, Any] | None = None
    holiday_credit_min: float = 0
    absence_credit_min: float = 0
    target_min: float = 0
    extra_credit_min: float = 0
    worked_min: float = 0
    break_min: float = 0
    surcharge_min: float = 0
    delta_min: float = 0
    first_start: str | None = None
    last_end: str | None = None
    running: bool = False
    is_workday: bool = False
    is_future: bool = False
    employed: bool = True
    vacation_days: float = 0
    absences: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    edited: bool = False
    worklog_min: int = 0            # annotated minutes (work log) on this day
    worklog_required_min: int = 0   # minimum annotated minutes when the work log is required
    worklog_ok: bool = True         # False = requirement not met (day in the past)

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        for k in ("scheduled_min", "holiday_credit_min", "absence_credit_min", "target_min",
                  "extra_credit_min", "worked_min", "break_min", "surcharge_min", "delta_min"):
            d[k] = round(d[k], 2)
        return d


def _employed(user: User, d: date) -> bool:
    if user.employment_start and d < user.employment_start:
        return False
    return not (user.employment_end and d > user.employment_end)


def compute_days(ctx: Context, edited_entry_ids: set[int] | None = None) -> list[Day]:
    user, st = ctx.user, ctx.settings
    tz = user.timezone
    today = ctx.now.astimezone(zone(tz)).date()
    prorata = st["holiday_mode"] == "prorata"
    ft_daily = st["fulltime_weekly_minutes"] / 5.0
    surcharge_pct = float(st["holiday_work_surcharge_percent"] or 0)
    edited_entry_ids = edited_entry_ids or set()

    # Pre-bucket entries per local day.
    by_day: dict[date, list[tuple[datetime, datetime, TimeEntry]]] = defaultdict(list)
    for e in ctx.entries:
        end = e.end_at or ctx.now
        if end <= e.start_at:
            continue
        d0 = e.start_at.astimezone(zone(tz)).date()
        d1 = end.astimezone(zone(tz)).date()
        for d in daterange(max(d0, ctx.start), min(d1, ctx.end)):
            ds, de = day_bounds_utc(d, tz)
            a, b = max(e.start_at, ds), min(end, de)
            if b > a:
                by_day[d].append((a, b, e))

    days: list[Day] = []
    for d in daterange(ctx.start, ctx.end):
        day = Day(date=d.isoformat(), weekday=d.weekday())
        day.employed = _employed(user, d)
        day.is_future = d > today
        sched = schedule_for(ctx.schedules, d)
        scheduled = sched.minutes_for(d) if (sched and day.employed) else 0
        pensum = (sched.pensum_percent if sched else 100.0) / 100.0
        day.scheduled_min = scheduled
        day.is_workday = scheduled > 0

        hol = ctx.holidays.get(d)
        hol_h = holiday_halves(hol.fraction) if hol else set()
        if hol:
            day.holiday = {"name": hol.name, "fraction": hol.fraction}
        if hol_h and day.employed:
            if prorata:
                day.holiday_credit_min = (pensum * ft_daily * len(hol_h) / 2.0) if d.weekday() < 5 else 0.0
            else:
                day.holiday_credit_min = scheduled * len(hol_h) / 2.0

        covered: set[str] = set(hol_h)
        for a in ctx.absences:
            halves = absence_halves(a, d)
            if not halves:
                continue
            t = ctx.types.get(a.type_id)
            effective = halves - covered if a.status == ABSENCE_APPROVED else set()
            info = {"id": a.id, "type": t.key if t else None, "label": t.label if t else "",
                    "color": t.color if t else "#888", "status": a.status,
                    "halves": sorted(halves), "category": t.category if t else "other"}
            day.absences.append(info)
            if not effective or not day.employed:
                continue
            covered |= effective
            if t and t.credits_time and scheduled > 0:
                day.absence_credit_min += scheduled * len(effective) / 2.0
            if t and t.deducts_vacation and scheduled > 0:
                day.vacation_days += len(effective) / 2.0

        # Worked time
        segs = sorted(by_day.get(d, []), key=lambda x: x[0])
        work = [(a, b, e) for a, b, e in segs if e.kind == "work"]
        day.worked_min = sum(minutes_between(a, b) for a, b, _ in work)
        if work:
            first, last = work[0][0], max(b for _, b, _ in work)
            day.first_start = first.isoformat()
            day.last_end = last.isoformat()
            day.break_min = max(0.0, minutes_between(first, last) - day.worked_min)
        day.running = any(e.end_at is None for _, _, e in segs)
        day.edited = any(e.id in edited_entry_ids or e.source == "manual" for _, _, e in segs)

        credits = day.holiday_credit_min + day.absence_credit_min
        day.target_min = max(0.0, scheduled - credits)
        day.extra_credit_min = max(0.0, credits - scheduled)
        if hol_h and day.worked_min and surcharge_pct:
            day.surcharge_min = day.worked_min * surcharge_pct / 100.0 * len(hol_h) / 2.0
        if day.is_future:
            day.delta_min = 0.0
        else:
            day.delta_min = day.worked_min - day.target_min + day.extra_credit_min + day.surcharge_min

        if st["break_rules_enabled"] and day.worked_min:
            w, b = day.worked_min, day.break_min
            if (w > 540 and b < 60) or (w > 420 and b < 30) or (w > 330 and b < 15):
                day.warnings.append("break_too_short")
        if day.worked_min > 0 and not day.employed:
            day.warnings.append("outside_employment")
        days.append(day)
    _apply_worklog(ctx, days, today)
    return days



def _apply_worklog(ctx: Context, days: list[Day], today: date) -> None:
    """Annotated minutes per day and whether the company's work-log requirement is met."""
    st = ctx.settings
    required = st.get("worklog_mode") == "required"
    pct = int(st.get("worklog_required_percent") or 0)
    for day in days:
        d = date.fromisoformat(day.date)
        day.worklog_min = int(ctx.worklog_minutes.get(d, 0))
        if required and day.worked_min > 0:
            day.worklog_required_min = int(-(-day.worked_min * pct // 100))
            day.worklog_ok = d >= today or day.worklog_min >= day.worklog_required_min

def summarize(days: list[Day]) -> dict[str, float]:
    past = [d for d in days if not d.is_future]
    return {
        "scheduled_min": round(sum(d.scheduled_min for d in days), 2),
        "target_min": round(sum(d.target_min for d in past), 2),
        "target_total_min": round(sum(d.target_min for d in days), 2),
        "worked_min": round(sum(d.worked_min for d in days), 2),
        "credit_min": round(sum(d.holiday_credit_min + d.absence_credit_min for d in days), 2),
        "delta_min": round(sum(d.delta_min for d in days), 2),
        "vacation_days": round(sum(d.vacation_days for d in days), 2),
        "workdays": sum(1 for d in days if d.is_workday),
    }


# --------------------------------------------------------------------------- time balance

def _time_adjustments(user: User, upto: date) -> list[BalanceAdjustment]:
    return list(db.session.scalars(db.select(BalanceAdjustment).where(
        BalanceAdjustment.user_id == user.id, BalanceAdjustment.account == "time",
        BalanceAdjustment.is_deleted.is_(False), BalanceAdjustment.effective_date <= upto)
        .order_by(BalanceAdjustment.effective_date, BalanceAdjustment.id)))


def time_balance(user: User, as_of: date | None = None) -> dict[str, float]:
    """Balance through ``as_of`` (default: yesterday) and today's running delta."""
    today = local_today(user.timezone)
    as_of = as_of or (today - timedelta(days=1))
    start = account_start(user)
    adjustments = sum(a.amount for a in _time_adjustments(user, max(as_of, today)))
    balance = adjustments
    today_delta = 0.0
    if start <= today:
        ctx = load_context(user, start, max(as_of, today), include_pending=False)
        for day in compute_days(ctx):
            d = date.fromisoformat(day.date)
            if d <= as_of:
                balance += day.delta_min
            if d == today:
                today_delta = day.delta_min
    return {"balance_min": round(balance, 2), "today_delta_min": round(today_delta, 2),
            "as_of": as_of.isoformat()}


def time_statement(user: User, year: int) -> dict[str, Any]:
    """Bank-statement view: opening balance, per-month figures, adjustments, closing balance."""
    start = account_start(user)
    today = local_today(user.timezone)
    # Like the balance: complete days only (through yesterday).
    y_start, y_end = date(year, 1, 1), min(date(year, 12, 31), today - timedelta(days=1))
    opening = 0.0
    adjustments = [a for a in _time_adjustments(user, y_end if y_end >= y_start else y_start)]
    opening += sum(a.amount for a in adjustments if a.effective_date < y_start)
    months: list[dict[str, Any]] = []
    if start < y_start:
        ctx = load_context(user, start, y_start - timedelta(days=1), include_pending=False)
        opening += sum(d.delta_min for d in compute_days(ctx))
    running = opening
    if y_end >= y_start:
        ctx = load_context(user, max(start, y_start), y_end, include_pending=False) if start <= y_end else None
        days = compute_days(ctx) if ctx else []
        by_month: dict[int, list[Day]] = defaultdict(list)
        for day in days:
            by_month[int(day.date[5:7])].append(day)
        for m in range(1, 13):
            mdays = by_month.get(m, [])
            if not mdays:
                if date(year, m, 1) > today:
                    break
                continue  # before the employment/account start
            adj = [a for a in adjustments if a.effective_date.year == year and a.effective_date.month == m]
            s = summarize(mdays)
            adj_total = sum(a.amount for a in adj)
            running += s["delta_min"] + adj_total
            months.append({"month": m, **s, "adjustments_min": round(adj_total, 2),
                           "balance_min": round(running, 2)})
    return {
        "user_id": user.id, "year": year, "opening_min": round(opening, 2),
        "months": months, "closing_min": round(running, 2),
        "adjustments": [serialize_adjustment(a) for a in adjustments if a.effective_date.year == year],
    }


def serialize_adjustment(a: BalanceAdjustment) -> dict[str, Any]:
    return {"id": a.id, "account": a.account, "amount": a.amount, "effective_date": a.effective_date.isoformat(),
            "kind": a.kind, "reason": a.reason,
            "created_by": {"id": a.created_by.id, "name": a.created_by.name} if a.created_by else None,
            "created_at": a.created_at.isoformat()}


# --------------------------------------------------------------------------- vacation

def workdays_factor(schedules: list[WorkSchedule], s: date, e: date) -> float:
    """Average scheduled days per week over [s, e] divided by 5 (1.0 for a five-day schedule)."""
    total, days = 0.0, 0
    d = s
    while d <= e:
        sched = schedule_for(schedules, d)
        if sched is not None:
            total += sum(1 for w in WEEKDAYS if getattr(sched, f"minutes_{w}") > 0)
            days += 1
        d += timedelta(days=1)
    return (total / days) / 5.0 if days else 1.0


def _entitlement_for_year(user: User, year: int, overrides: dict[int, float],
                          schedules: list[WorkSchedule] | None = None, prorate: bool = False) -> float:
    """Yearly entitlement, pro-rated for the employment period of that year and, when the company
    setting is on, by the person's scheduled days per week (full-time value × days/5)."""
    if year in overrides:
        return overrides[year]
    y_start, y_end = date(year, 1, 1), date(year, 12, 31)
    s = max(y_start, user.employment_start or y_start)
    e = min(y_end, user.employment_end or y_end)
    if e < s:
        return 0.0
    frac = ((e - s).days + 1) / ((y_end - y_start).days + 1)
    factor = workdays_factor(schedules, s, e) if (prorate and schedules is not None) else 1.0
    return round(user.vacation_days_per_year * frac * factor * 2) / 2.0  # round to half days


def vacation_account(user: User, year: int) -> dict[str, Any]:
    start_year = account_start(user).year
    today = local_today(user.timezone)
    overrides = {e.year: e.days for e in db.session.scalars(
        db.select(VacationEntitlement).where(VacationEntitlement.user_id == user.id))}
    adjustments = list(db.session.scalars(db.select(BalanceAdjustment).where(
        BalanceAdjustment.user_id == user.id, BalanceAdjustment.account == "vacation",
        BalanceAdjustment.is_deleted.is_(False))))
    first = min(start_year, year)
    ctx = load_context(user, date(first, 1, 1), date(year, 12, 31), include_pending=True)
    days = compute_days(ctx)
    # pending requests do not count in compute_days; compute separately
    pending_by_year: dict[int, float] = defaultdict(float)
    used_by_year: dict[int, float] = defaultdict(float)
    planned_by_year: dict[int, float] = defaultdict(float)
    vac_type_ids = {t.id for t in ctx.types.values() if t.deducts_vacation}
    pending = [a for a in ctx.absences if a.status == ABSENCE_PENDING and a.type_id in vac_type_ids]
    for day in days:
        d = date.fromisoformat(day.date)
        if day.vacation_days:
            (used_by_year if d <= today else planned_by_year)[d.year] += day.vacation_days
        if pending and day.scheduled_min > 0 and day.employed:
            hol = ctx.holidays.get(d)
            free = {AM, PM} - (holiday_halves(hol.fraction) if hol else set())
            for a in pending:
                pending_by_year[d.year] += len(absence_halves(a, d) & free) / 2.0

    carried = 0.0
    result: dict[str, Any] = {}
    prorate = bool(settings_svc.get("vacation_prorate_workdays"))
    for y in range(start_year, year + 1):
        ent = _entitlement_for_year(user, y, overrides, ctx.schedules, prorate)
        adj = sum(a.amount for a in adjustments if a.effective_date.year == y)
        taken, planned = used_by_year[y], planned_by_year[y]
        remaining = carried + ent + adj - taken - planned
        result = {
            "user_id": user.id, "year": y, "carried_over": round(carried, 2), "entitlement": ent,
            "adjustments": round(adj, 2), "taken": round(taken, 2), "planned": round(planned, 2),
            "pending": round(pending_by_year[y], 2), "remaining": round(remaining, 2),
            "remaining_after_pending": round(remaining - pending_by_year[y], 2),
            "entitlement_overridden": y in overrides,
        }
        carried = remaining
    if year < start_year:
        result = {"user_id": user.id, "year": year, "carried_over": 0, "entitlement": 0, "adjustments": 0,
                  "taken": 0, "planned": 0, "pending": 0, "remaining": 0, "remaining_after_pending": 0,
                  "entitlement_overridden": False}
    result["adjustment_items"] = [serialize_adjustment(a) for a in adjustments if a.effective_date.year == year]
    return result


def count_absence_days(user: User, a_start: date, a_end: date, start_half: str, end_half: str) -> float:
    """Working days an absence would cover (excludes weekends/non-workdays and holidays)."""
    probe = Absence(user_id=user.id, type_id=0, start_date=a_start, end_date=a_end,
                    start_half=start_half, end_half=end_half, status=ABSENCE_APPROVED)
    ctx = load_context(user, a_start, a_end, include_pending=False)
    total = 0.0
    for d in daterange(a_start, a_end):
        sched = schedule_for(ctx.schedules, d)
        if not sched or not _employed(user, d) or sched.minutes_for(d) <= 0:
            continue
        hol = ctx.holidays.get(d)
        free = {AM, PM} - (holiday_halves(hol.fraction) if hol else set())
        total += len(absence_halves(probe, d) & free) / 2.0
    return total
