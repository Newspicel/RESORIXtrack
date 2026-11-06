# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Pure unit tests of the day/account engine (no database access: transient objects)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from resorixtrack.models import Absence, AbsenceType, Holiday, TimeEntry, User, WorkSchedule
from resorixtrack.services.accounts import Context, absence_halves, compute_days, holiday_halves, summarize
from resorixtrack.services.settings import DEFAULTS

ZH = ZoneInfo("Europe/Zurich")
NOW = datetime(2026, 12, 31, 23, 0, tzinfo=UTC)

VACATION = AbsenceType(id=1, key="vacation", label="Vacation", color="#1", category="vacation",
                       credits_time=True, deducts_vacation=True)
SICK = AbsenceType(id=2, key="sick", label="Sick", color="#2", category="sick", credits_time=True,
                   deducts_vacation=False)
COMP = AbsenceType(id=3, key="comp_time", label="Time off in lieu", color="#3", category="other",
                   credits_time=False, deducts_vacation=False)
TYPES = {t.id: t for t in (VACATION, SICK, COMP)}


def user(start=date(2026, 1, 1), end=None, tz="Europe/Zurich"):
    return User(id=1, email="u@x", name="U", timezone=tz, employment_start=start, employment_end=end,
                vacation_days_per_year=25)


def schedule(valid_from=date(2026, 1, 1), per_day=504, pensum=100.0, days=(0, 1, 2, 3, 4)):
    names = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    return WorkSchedule(user_id=1, valid_from=valid_from, pensum_percent=pensum,
                        **{f"minutes_{n}": (per_day if i in days else 0) for i, n in enumerate(names)})


def entry(day: date, start: str, end: str | None, kind="work", eid=None, tz=ZH):
    def at(hm):
        h, m = map(int, hm.split(":"))
        return datetime(day.year, day.month, day.day, h, m, tzinfo=tz).astimezone(UTC)
    e_end = at(end) if end else None
    if e_end is not None and e_end <= at(start):
        e_end += timedelta(days=1)
    return TimeEntry(id=eid, user_id=1, kind=kind, start_at=at(start), end_at=e_end, source="clock")


def absence(start, end=None, type_=VACATION, sh="full", eh="full", status="approved", aid=1):
    return Absence(id=aid, user_id=1, type_id=type_.id, start_date=start, end_date=end or start,
                   start_half=sh, end_half=eh, status=status)


def ctx(start, end, *, u=None, schedules=None, holidays=None, absences=None, entries=None, now=NOW, **settings):
    st = {**DEFAULTS, **settings}
    hol = {h.date: h for h in (holidays or [])}
    return Context(user=u or user(), start=start, end=end, schedules=schedules or [schedule()],
                   holidays=hol, absences=absences or [], types=TYPES, entries=entries or [], settings=st,
                   now=now)


def one(c):
    days = compute_days(c)
    assert len(days) == 1
    return days[0]


MON = date(2026, 11, 2)  # Monday


class TestHalves:
    def test_single_day(self):
        assert absence_halves(absence(MON), MON) == {"am", "pm"}
        assert absence_halves(absence(MON, sh="am"), MON) == {"am"}
        assert absence_halves(absence(MON, sh="pm"), MON) == {"pm"}

    def test_multi_day(self):
        a = absence(MON, MON + timedelta(days=2), sh="pm", eh="am")
        assert absence_halves(a, MON) == {"pm"}
        assert absence_halves(a, MON + timedelta(days=1)) == {"am", "pm"}
        assert absence_halves(a, MON + timedelta(days=2)) == {"am"}
        assert absence_halves(a, MON + timedelta(days=3)) == set()

    def test_holiday_halves(self):
        assert holiday_halves(1.0) == {"am", "pm"}
        assert holiday_halves(0.5) == {"pm"}
        assert holiday_halves(0) == set()


class TestTargets:
    def test_regular_workday(self):
        d = one(ctx(MON, MON, entries=[entry(MON, "08:00", "12:00"), entry(MON, "12:30", "16:54")]))
        assert d.scheduled_min == 504
        assert d.target_min == 504
        assert d.worked_min == 504
        assert d.break_min == 30
        assert d.delta_min == 0

    def test_weekend_has_no_target_and_work_counts_as_overtime(self):
        sat = MON + timedelta(days=5)
        d = one(ctx(sat, sat, entries=[entry(sat, "09:00", "11:00")]))
        assert d.target_min == 0
        assert d.delta_min == 120
        assert not d.is_workday

    def test_missing_day_is_negative(self):
        assert one(ctx(MON, MON)).delta_min == -504

    def test_future_days_have_no_delta(self):
        d = one(ctx(MON, MON, now=datetime(2026, 11, 1, 12, tzinfo=UTC)))
        assert d.is_future and d.delta_min == 0 and d.target_min == 504

    def test_outside_employment(self):
        d = one(ctx(MON, MON, u=user(start=MON + timedelta(days=1))))
        assert d.scheduled_min == 0 and d.delta_min == 0 and not d.employed
        d2 = one(ctx(MON, MON, u=user(end=MON - timedelta(days=1))))
        assert d2.scheduled_min == 0

    def test_schedule_versions(self):
        s1 = schedule(valid_from=date(2026, 1, 1), per_day=504)
        s2 = schedule(valid_from=MON + timedelta(days=1), per_day=403, pensum=80)
        days = compute_days(ctx(MON, MON + timedelta(days=1), schedules=[s1, s2]))
        assert [d.scheduled_min for d in days] == [504, 403]


class TestHolidays:
    def test_full_holiday_on_workday_sets_target_zero(self):
        d = one(ctx(MON, MON, holidays=[Holiday(date=MON, name="X", fraction=1.0)]))
        assert d.holiday_credit_min == 504 and d.target_min == 0 and d.delta_min == 0

    def test_half_holiday(self):
        d = one(ctx(MON, MON, holidays=[Holiday(date=MON, name="Eve", fraction=0.5)],
                    entries=[entry(MON, "08:00", "12:12")]))
        assert d.target_min == 252 and d.delta_min == 0

    def test_holiday_on_weekend_has_no_effect(self):
        sat = MON + timedelta(days=5)
        d = one(ctx(sat, sat, holidays=[Holiday(date=sat, name="X", fraction=1.0)]))
        assert d.holiday_credit_min == 0 and d.delta_min == 0

    def test_part_timer_free_day_scheduled_mode(self):
        # Works Tue-Fri; Monday holiday gives nothing.
        s = schedule(per_day=504, pensum=80, days=(1, 2, 3, 4))
        d = one(ctx(MON, MON, schedules=[s], holidays=[Holiday(date=MON, name="Easter Monday", fraction=1.0)]))
        assert d.holiday_credit_min == 0 and d.delta_min == 0

    def test_part_timer_prorata_mode(self):
        s = schedule(per_day=504, pensum=80, days=(1, 2, 3, 4))
        d = one(ctx(MON, MON, schedules=[s], holiday_mode="prorata",
                    holidays=[Holiday(date=MON, name="Easter Monday", fraction=1.0)]))
        # 80 % x 2520/5 = 403.2 credited although Monday is not a workday
        assert d.holiday_credit_min == pytest.approx(403.2)
        assert d.extra_credit_min == pytest.approx(403.2)
        assert d.delta_min == pytest.approx(403.2)

    def test_prorata_on_workday(self):
        s = schedule(per_day=504, pensum=80, days=(0, 1, 2, 3))
        d = one(ctx(MON, MON, schedules=[s], holiday_mode="prorata",
                    holidays=[Holiday(date=MON, name="X", fraction=1.0)]))
        assert d.target_min == pytest.approx(504 - 403.2)
        assert d.delta_min == pytest.approx(-(504 - 403.2))

    def test_work_on_holiday_counts_fully_plus_surcharge(self):
        d = one(ctx(MON, MON, holidays=[Holiday(date=MON, name="X", fraction=1.0)],
                    entries=[entry(MON, "08:00", "10:00")], holiday_work_surcharge_percent=50))
        assert d.target_min == 0
        assert d.surcharge_min == 60
        assert d.delta_min == 180


class TestAbsences:
    def test_vacation_credits_target_and_counts_one_day(self):
        d = one(ctx(MON, MON, absences=[absence(MON)]))
        assert d.absence_credit_min == 504 and d.target_min == 0 and d.delta_min == 0
        assert d.vacation_days == 1

    def test_half_day_vacation(self):
        d = one(ctx(MON, MON, absences=[absence(MON, sh="am")], entries=[entry(MON, "13:00", "17:12")]))
        assert d.vacation_days == 0.5 and d.target_min == 252 and d.delta_min == 0

    def test_vacation_on_holiday_not_deducted(self):
        d = one(ctx(MON, MON, absences=[absence(MON)], holidays=[Holiday(date=MON, name="X", fraction=1.0)]))
        assert d.vacation_days == 0

    def test_vacation_pm_on_half_holiday(self):
        # 24 Dec afternoon holiday + vacation pm -> nothing deducted; vacation am -> half day
        d = one(ctx(MON, MON, absences=[absence(MON, sh="pm")],
                    holidays=[Holiday(date=MON, name="Eve", fraction=0.5)]))
        assert d.vacation_days == 0
        d2 = one(ctx(MON, MON, absences=[absence(MON)], holidays=[Holiday(date=MON, name="Eve", fraction=0.5)]))
        assert d2.vacation_days == 0.5 and d2.target_min == 0

    def test_vacation_on_weekend_not_deducted(self):
        days = compute_days(ctx(MON, MON + timedelta(days=6), absences=[absence(MON, MON + timedelta(days=6))]))
        assert sum(d.vacation_days for d in days) == 5

    def test_pending_absence_has_no_effect(self):
        d = one(ctx(MON, MON, absences=[absence(MON, status="pending")]))
        assert d.target_min == 504 and d.vacation_days == 0 and d.absences[0]["status"] == "pending"

    def test_sick_credits_time(self):
        d = one(ctx(MON, MON, absences=[absence(MON, type_=SICK)]))
        assert d.target_min == 0 and d.delta_min == 0 and d.vacation_days == 0

    def test_comp_time_consumes_balance(self):
        d = one(ctx(MON, MON, absences=[absence(MON, type_=COMP)]))
        assert d.target_min == 504 and d.delta_min == -504

    def test_two_half_day_absences(self):
        d = one(ctx(MON, MON, absences=[absence(MON, sh="am", type_=SICK, aid=1),
                                        absence(MON, sh="pm", aid=2)]))
        assert d.target_min == 0 and d.vacation_days == 0.5


class TestEntries:
    def test_entry_across_midnight_is_split(self):
        days = compute_days(ctx(MON, MON + timedelta(days=1), entries=[entry(MON, "22:00", "02:00")]))
        assert [d.worked_min for d in days] == [120, 120]

    def test_running_entry_counts_until_now(self):
        now = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)  # 10:00 Zurich
        d = one(ctx(MON, MON, entries=[entry(MON, "08:00", None)], now=now))
        assert d.running and d.worked_min == 120

    def test_breaks_are_not_worked_time(self):
        d = one(ctx(MON, MON, entries=[entry(MON, "08:00", "12:00"), entry(MON, "12:00", "12:30", kind="break"),
                                       entry(MON, "12:30", "17:00")]))
        assert d.worked_min == 510 and d.break_min == 30

    def test_break_rule_warning(self):
        d = one(ctx(MON, MON, entries=[entry(MON, "08:00", "16:00")]))
        assert "break_too_short" in d.warnings
        d2 = one(ctx(MON, MON, entries=[entry(MON, "08:00", "12:00"), entry(MON, "12:30", "16:30")]))
        assert d2.warnings == []

    def test_dst_spring_forward(self):
        # 29 Mar 2026: 02:00 -> 03:00 in Zurich; 00:00-06:00 local is only 5 hours
        d0 = date(2026, 3, 29)
        start = datetime(2026, 3, 29, 0, 0, tzinfo=ZH).astimezone(UTC)
        end = datetime(2026, 3, 29, 6, 0, tzinfo=ZH).astimezone(UTC)
        e = TimeEntry(user_id=1, kind="work", start_at=start, end_at=end, source="clock")
        d = one(ctx(d0, d0, entries=[e]))
        assert d.worked_min == 300

    def test_dst_fall_back(self):
        d0 = date(2026, 10, 25)
        start = datetime(2026, 10, 25, 0, 0, tzinfo=ZH).astimezone(UTC)
        end = datetime(2026, 10, 25, 6, 0, tzinfo=ZH).astimezone(UTC)
        e = TimeEntry(user_id=1, kind="work", start_at=start, end_at=end, source="clock")
        assert one(ctx(d0, d0, entries=[e])).worked_min == 420

    def test_other_timezone_user(self):
        ny = ZoneInfo("America/New_York")
        u = user(tz="America/New_York")
        e = entry(MON, "23:00", "23:30", tz=ny)  # 05:00 UTC next day
        days = compute_days(ctx(MON, MON + timedelta(days=1), u=u, entries=[e]))
        assert days[0].worked_min == 30 and days[1].worked_min == 0


def test_summarize():
    days = compute_days(ctx(MON, MON + timedelta(days=6), entries=[entry(MON, "08:00", "17:24")],
                            absences=[absence(MON + timedelta(days=1))]))
    s = summarize(days)
    assert s["workdays"] == 5
    assert s["vacation_days"] == 1
    assert s["worked_min"] == 564
    assert s["delta_min"] == 564 - 504 - 3 * 504
