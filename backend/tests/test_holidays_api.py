# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Every employee sees the public-holiday calendar that applies to them (read-only)."""

from datetime import date

from conftest import PASSWORD

from resorixtrack.extensions import db
from resorixtrack.models import Holiday, HolidayCalendar
from resorixtrack.services import accounts


def _clear_calendars() -> None:
    """The test app ships with the Fribourg preset as company default; start from nothing."""
    for cal in db.session.scalars(db.select(HolidayCalendar)).all():
        db.session.delete(cal)
    db.session.commit()


def _calendar(name: str, *, default: bool = False, holidays: tuple[tuple[date, str], ...] = ()) -> HolidayCalendar:
    cal = HolidayCalendar(name=name, is_default=default)
    db.session.add(cal)
    db.session.flush()
    for d, label in holidays:
        db.session.add(Holiday(calendar_id=cal.id, date=d, name=label))
    db.session.commit()
    return cal


def test_no_calendar_configured_gives_null(make_client, org):
    _clear_calendars()
    r = make_client("anna@example.com").get("/api/v1/holiday-calendars/mine")
    assert r.status_code == 200 and r.get_json() is None


def test_resolution_order_default_team_user(app, make_client, org):
    _clear_calendars()
    company = _calendar("Company", default=True, holidays=((date(2026, 12, 25), "Christmas Day"),
                                                           (date(2027, 1, 1), "New Year's Day")))
    team_cal = _calendar("Team A region", holidays=((date(2026, 8, 1), "Swiss National Day"),))
    personal = _calendar("Personal", holidays=((date(2026, 5, 1), "Labour Day"),))
    anna = make_client("anna@example.com")

    data = anna.get("/api/v1/holiday-calendars/mine").get_json()
    assert (data["id"], data["source"]) == (company.id, "default")
    assert [h["name"] for h in data["holidays"]] == ["Christmas Day", "New Year's Day"]
    # year filter
    data = anna.get("/api/v1/holiday-calendars/mine?year=2027").get_json()
    assert [h["date"] for h in data["holidays"]] == ["2027-01-01"]

    org["team_a"].holiday_calendar_id = team_cal.id
    db.session.commit()
    data = anna.get("/api/v1/holiday-calendars/mine").get_json()
    assert (data["id"], data["source"]) == (team_cal.id, "team")

    org["anna"].holiday_calendar_id = personal.id
    db.session.commit()
    data = anna.get("/api/v1/holiday-calendars/mine").get_json()
    assert (data["id"], data["source"]) == (personal.id, "user")
    # the same calendar reduces the target hours (single source of truth with the account calculation)
    assert accounts.resolve_calendar_id(org["anna"]) == personal.id
    # a colleague in Team B without own assignment still gets the company default
    data = make_client("carl@example.com").get("/api/v1/holiday-calendars/mine").get_json()
    assert (data["id"], data["source"]) == (company.id, "default")


def test_employee_can_read_but_never_write(make_client, org):
    _clear_calendars()
    cal = _calendar("Company", default=True, holidays=((date(2026, 12, 25), "Christmas Day"),))
    hol_id = db.session.scalar(db.select(Holiday.id))
    anna = make_client("anna@example.com")
    assert anna.get(f"/api/v1/holiday-calendars/{cal.id}").status_code == 200
    assert anna.post(f"/api/v1/holiday-calendars/{cal.id}/holidays", json={"date": "2026-12-26", "name": "Probe"}).status_code == 403
    assert anna.patch(f"/api/v1/holiday-calendars/{cal.id}", json={"name": "Hacked"}).status_code == 403
    assert anna.delete(f"/api/v1/holiday-calendars/{cal.id}").status_code == 403
    assert anna.patch(f"/api/v1/holidays/{hol_id}", json={"name": "Probe"}).status_code == 403
    assert anna.delete(f"/api/v1/holidays/{hol_id}").status_code == 403
    assert anna.post("/api/v1/holiday-calendars/presets/ch-fr-fribourg").status_code == 403
    assert db.session.get(HolidayCalendar, cal.id).name == "Company"
    assert db.session.scalar(db.select(db.func.count(Holiday.id))) == 1


def test_api_token_needs_absences_scope(make_client, org):
    anna = make_client("anna@example.com")
    for scopes, expected in ((["clock"], 403), (["absences:read"], 200)):
        tok = anna.post("/api/v1/tokens", json={"name": " ".join(scopes), "scopes": scopes,
                                                "current_password": PASSWORD}).get_json()
        via_token = make_client()
        via_token.bearer = tok["token"]
        r = via_token.get("/api/v1/holiday-calendars/mine")
        assert r.status_code == expected, (scopes, r.get_json())
