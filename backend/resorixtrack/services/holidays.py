# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Holiday calendars: CRUD + import from the ``holidays`` library (countries and subdivisions)."""

from __future__ import annotations

from datetime import date
from typing import Any

import holidays as pyholidays

from ..errors import Conflict, NotFound, Validation
from ..extensions import db
from ..models import Holiday, HolidayCalendar, Team, User

# Common half-day company holidays in CH/DE that are not statutory.
HALF_DAY_EXTRAS = {(12, 24): "Christmas Eve (afternoon)", (12, 31): "New Year's Eve (afternoon)"}


def serialize_calendar(c: HolidayCalendar, with_holidays: bool = False, year: int | None = None) -> dict[str, Any]:
    data = {"id": c.id, "name": c.name, "region_code": c.region_code, "description": c.description,
            "is_default": c.is_default,
            "holiday_count": len(c.holidays),
            "years": sorted({h.date.year for h in c.holidays}),
            "user_count": db.session.scalar(db.select(db.func.count(User.id)).where(
                User.holiday_calendar_id == c.id)) or 0,
            "team_count": db.session.scalar(db.select(db.func.count(Team.id)).where(
                Team.holiday_calendar_id == c.id)) or 0}
    if with_holidays:
        data["holidays"] = [serialize_holiday(h) for h in c.holidays if year is None or h.date.year == year]
    return data


def serialize_holiday(h: Holiday) -> dict[str, Any]:
    return {"id": h.id, "calendar_id": h.calendar_id, "date": h.date.isoformat(), "name": h.name,
            "fraction": h.fraction}


def applicable_calendar(user: User) -> tuple[HolidayCalendar | None, str]:
    """The calendar that applies to a person and where it comes from: a personal assignment
    (``user``), the team's calendar (``team``) or the company default (``default``). ``none`` when
    nothing is configured. The target-hour calculation (``accounts.resolve_calendar_id``) uses the
    same order, so what people see here is what reduces their target."""
    if user.holiday_calendar_id:
        c = db.session.get(HolidayCalendar, user.holiday_calendar_id)
        if c is not None:
            return c, "user"
    if user.team_id:
        team = db.session.get(Team, user.team_id)
        if team is not None and team.holiday_calendar_id:
            c = db.session.get(HolidayCalendar, team.holiday_calendar_id)
            if c is not None:
                return c, "team"
    c = db.session.scalar(db.select(HolidayCalendar).where(HolidayCalendar.is_default.is_(True)).limit(1))
    return (c, "default") if c is not None else (None, "none")


def get_calendar(cal_id: int) -> HolidayCalendar:
    c = db.session.get(HolidayCalendar, cal_id)
    if c is None:
        raise NotFound("Holiday calendar not found")
    return c


def save_calendar(data: dict[str, Any], cal: HolidayCalendar | None = None) -> HolidayCalendar:
    name = (data.get("name") or (cal.name if cal else "")).strip()
    if not name:
        raise Validation("Name is required", fields={"name": "required"})
    clash = db.session.scalar(db.select(HolidayCalendar.id).where(HolidayCalendar.name == name))
    if clash and (cal is None or clash != cal.id):
        raise Conflict("A calendar with this name already exists", fields={"name": "taken"})
    if cal is None:
        cal = HolidayCalendar(name=name)
        db.session.add(cal)
    cal.name = name[:120]
    for key in ("region_code", "description"):
        if key in data:
            setattr(cal, key, (data[key] or "").strip())
    if data.get("is_default"):
        for other in db.session.scalars(db.select(HolidayCalendar).where(HolidayCalendar.is_default.is_(True))):
            other.is_default = False
        cal.is_default = True
    elif "is_default" in data:
        cal.is_default = False
    db.session.flush()
    return cal


def save_holiday(cal: HolidayCalendar, data: dict[str, Any], h: Holiday | None = None) -> Holiday:
    d: date = data.get("date") or (h.date if h else None)
    if d is None:
        raise Validation("Date is required", fields={"date": "required"})
    from . import signoffs

    signoffs.ensure_holiday_change_allowed(d)
    if h is not None:
        signoffs.ensure_holiday_change_allowed(h.date)
    fraction = float(data.get("fraction", h.fraction if h else 1.0))
    if fraction not in (0.5, 1.0):
        raise Validation("Fraction must be 1 (full day) or 0.5 (afternoon)", fields={"fraction": "invalid"})
    name = (data.get("name") or (h.name if h else "")).strip()
    if not name:
        raise Validation("Name is required", fields={"name": "required"})
    clash = db.session.scalar(db.select(Holiday).where(Holiday.calendar_id == cal.id, Holiday.date == d))
    if clash is not None and (h is None or clash.id != h.id):
        raise Conflict("There is already a holiday on this date", fields={"date": "taken"})
    if h is None:
        h = Holiday(calendar_id=cal.id, date=d)
        db.session.add(h)
    h.date, h.name, h.fraction = d, name[:120], fraction
    db.session.flush()
    return h


def supported_countries() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for code, subdivs in pyholidays.list_supported_countries().items():
        out[code] = list(subdivs)
    return out


def import_holidays(cal: HolidayCalendar, country: str, subdiv: str | None, year: int,
                    include_half_days: bool = False, replace: bool = False) -> dict[str, int]:
    country = (country or "").upper()
    supported = pyholidays.list_supported_countries()
    if country not in supported:
        raise Validation("Unsupported country", fields={"country": "invalid"})
    if subdiv and subdiv not in supported[country]:
        raise Validation("Unsupported subdivision", fields={"subdiv": "invalid"})
    if not 1990 <= year <= 2100:
        raise Validation("Invalid year", fields={"year": "invalid"})
    source = pyholidays.country_holidays(country, subdiv=subdiv or None, years=year, language="en_US")
    existing = {h.date: h for h in cal.holidays if h.date.year == year}
    if replace:
        from . import signoffs

        for h in existing.values():
            signoffs.ensure_holiday_change_allowed(h.date)
        for h in existing.values():
            db.session.delete(h)
        db.session.flush()
        existing = {}
    added = skipped = 0
    items = sorted(source.items())
    if include_half_days:
        for (m, dd), name in HALF_DAY_EXTRAS.items():
            items.append((date(year, m, dd), name))
    from . import signoffs

    latest = signoffs.latest_signed_date()
    for d, name in items:
        if latest is not None and d <= latest:
            skipped += 1
            continue
        if d in existing:
            skipped += 1
            continue
        fraction = 0.5 if (d.month, d.day) in HALF_DAY_EXTRAS and "afternoon" in name else 1.0
        h = Holiday(calendar_id=cal.id, date=d, name=str(name)[:120], fraction=fraction)
        db.session.add(h)
        existing[d] = h
        added += 1
    if not cal.region_code:
        cal.region_code = f"{country}-{subdiv}" if subdiv else country
    db.session.flush()
    return {"added": added, "skipped": skipped}
