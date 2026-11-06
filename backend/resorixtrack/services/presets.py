# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Built-in holiday presets (initial data)."""

from __future__ import annotations

from datetime import date

from ..extensions import db
from ..models import Holiday, HolidayCalendar

# Public holidays of the City of Fribourg (canton FR, Catholic part), 2026-2029.
# Source: official overview provided by RESORIX AG.
FRIBOURG_CITY = {
    "key": "ch-fr-fribourg",
    "name": "CH-FR City of Fribourg",
    "region_code": "CH-FR",
    "description": "Public holidays of the City of Fribourg (2026–2029)",
    "holidays": {
        "New Year's Day": ("2026-01-01", "2027-01-01", "2028-01-01", "2029-01-01"),
        "Good Friday": ("2026-04-03", "2027-03-26", "2028-04-14", "2029-03-30"),
        "Ascension Day": ("2026-05-14", "2027-05-06", "2028-05-25", "2029-05-10"),
        "Corpus Christi": ("2026-06-04", "2027-05-27", "2028-06-15", "2029-05-31"),
        "Swiss National Day": ("2026-08-01", "2027-08-01", "2028-08-01", "2029-08-01"),
        "Assumption Day": ("2026-08-15", "2027-08-15", "2028-08-15", "2029-08-15"),
        "All Saints' Day": ("2026-11-01", "2027-11-01", "2028-11-01", "2029-11-01"),
        "Immaculate Conception": ("2026-12-08", "2027-12-08", "2028-12-08", "2029-12-08"),
        "Christmas Day": ("2026-12-25", "2027-12-25", "2028-12-25", "2029-12-25"),
    },
}

PRESETS = {FRIBOURG_CITY["key"]: FRIBOURG_CITY}


def preset_list() -> list[dict]:
    return [{"key": p["key"], "name": p["name"], "description": p["description"]} for p in PRESETS.values()]


def install_preset(key: str, *, make_default: bool = False) -> HolidayCalendar:
    p = PRESETS[key]
    cal = db.session.scalar(db.select(HolidayCalendar).where(HolidayCalendar.name == p["name"]))
    if cal is None:
        cal = HolidayCalendar(name=p["name"], region_code=p["region_code"], description=p["description"])
        db.session.add(cal)
        db.session.flush()
    existing = {h.date for h in db.session.scalars(db.select(Holiday).where(Holiday.calendar_id == cal.id))}
    for name, dates in p["holidays"].items():
        for ds in dates:
            d = date.fromisoformat(ds)
            if d not in existing:
                db.session.add(Holiday(calendar_id=cal.id, date=d, name=name, fraction=1.0))
    if make_default:
        for other in db.session.scalars(db.select(HolidayCalendar).where(HolidayCalendar.is_default.is_(True))):
            other.is_default = False
        cal.is_default = True
    db.session.flush()
    return cal
