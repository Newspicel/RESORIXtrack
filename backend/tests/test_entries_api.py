# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from conftest import DEFAULT_NOW

from resorixtrack.extensions import db
from resorixtrack.models import Revision, TimeEntry
from resorixtrack.timeutil import freeze

# DEFAULT_NOW = Thu 2026-11-05 15:00 Zurich


def local(day: str, hm: str) -> str:
    """Naive local timestamp, interpreted in the user's timezone by the API."""
    return f"{day}T{hm}:00"


def test_clock_state_machine(make_client, org):
    c = make_client("anna@example.com")
    assert c.get("/api/v1/clock").get_json()["state"] == "idle"
    assert c.post("/api/v1/clock/break", json={}).status_code == 409
    s = c.post("/api/v1/clock/start", json={}).get_json()
    assert s["state"] == "working"
    assert c.post("/api/v1/clock/start", json={}).get_json()["state"] == "working"  # idempotent
    freeze(DEFAULT_NOW + timedelta(hours=1))
    assert c.post("/api/v1/clock/break", json={}).get_json()["state"] == "on_break"
    freeze(DEFAULT_NOW + timedelta(hours=1, minutes=30))
    assert c.post("/api/v1/clock/resume", json={}).get_json()["state"] == "working"
    freeze(DEFAULT_NOW + timedelta(hours=2))
    s = c.post("/api/v1/clock/stop", json={}).get_json()
    assert s["state"] == "idle"
    assert s["today_worked_min"] == 90
    assert s["today_break_min"] == 30
    entries = c.get("/api/v1/entries?from=2026-11-05&to=2026-11-05").get_json()
    assert [e["kind"] for e in entries] == ["work", "break", "work"]
    assert all(e["source"] == "clock" for e in entries)
    assert c.post("/api/v1/clock/stop", json={}).status_code == 200  # idempotent
    assert c.post("/api/v1/clock/dance", json={}).status_code == 404


def test_clock_offline_timestamp(make_client, org):
    c = make_client("anna@example.com")
    at = (DEFAULT_NOW - timedelta(minutes=20)).isoformat()
    s = c.post("/api/v1/clock/start", json={"at": at}).get_json()
    assert s["since"].startswith("2026-11-05T13:40")
    future = (DEFAULT_NOW + timedelta(hours=1)).isoformat()
    assert c.post("/api/v1/clock/stop", json={"at": future}).status_code == 422
    too_old = (DEFAULT_NOW - timedelta(days=3)).isoformat()
    assert c.post("/api/v1/clock/stop", json={"at": too_old}).status_code == 422


def test_manual_entry_today_needs_no_reason(make_client, org):
    c = make_client("anna@example.com")
    r = c.post("/api/v1/entries", json={"start_at": local("2026-11-05", "08:00"), "end_at": local("2026-11-05", "12:00")})
    assert r.status_code == 201, r.get_json()
    e = r.get_json()
    assert e["start_at"] == "2026-11-05T07:00:00Z"  # stored in UTC
    assert e["source"] == "manual"


def test_manual_entry_past_requires_reason(make_client, org):
    c = make_client("anna@example.com")
    body = {"start_at": local("2026-11-03", "08:00"), "end_at": local("2026-11-03", "12:00")}
    r = c.post("/api/v1/entries", json=body)
    assert r.status_code == 422 and r.get_json()["error"]["fields"]["reason"] == "required"
    r = c.post("/api/v1/entries", json={**body, "reason": "Forgot to clock in"})
    assert r.status_code == 201
    hist = c.get(f"/api/v1/entries/{r.get_json()['id']}/history").get_json()
    assert hist[0]["action"] == "create" and hist[0]["reason"] == "Forgot to clock in"


def test_entry_validation(make_client, org):
    c = make_client("anna@example.com")
    r = c.post("/api/v1/entries", json={"start_at": local("2026-11-05", "12:00"), "end_at": local("2026-11-05", "08:00")})
    assert r.status_code == 422
    r = c.post("/api/v1/entries", json={"start_at": local("2026-11-05", "16:00"), "end_at": local("2026-11-05", "18:00")})
    assert r.status_code == 422  # future
    r = c.post("/api/v1/entries", json={"start_at": local("2026-11-02", "08:00"), "end_at": local("2026-11-03", "09:00"),
                                        "reason": "x"})
    assert r.status_code == 422  # > 24 h


def test_overlap_rejected(make_client, org):
    c = make_client("anna@example.com")
    c.post("/api/v1/entries", json={"start_at": local("2026-11-05", "08:00"), "end_at": local("2026-11-05", "12:00")})
    r = c.post("/api/v1/entries", json={"start_at": local("2026-11-05", "11:00"), "end_at": local("2026-11-05", "13:00")})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "overlap"
    # adjacent is fine
    r = c.post("/api/v1/entries", json={"start_at": local("2026-11-05", "12:00"), "end_at": local("2026-11-05", "12:30"),
                                        "kind": "break"})
    assert r.status_code == 201


def test_employee_edit_is_logged_and_visible(make_client, org):
    c = make_client("anna@example.com")
    e = c.post("/api/v1/entries", json={"start_at": local("2026-11-05", "08:00"),
                                        "end_at": local("2026-11-05", "12:00")}).get_json()
    r = c.patch(f"/api/v1/entries/{e['id']}", json={"start_at": local("2026-11-05", "07:45")})
    assert r.status_code == 200
    assert r.get_json()["edited"] is True
    hist = c.get(f"/api/v1/entries/{e['id']}/history").get_json()
    assert [h["action"] for h in hist] == ["create", "update"]
    assert hist[1]["before"]["start_at"] == "2026-11-05T07:00:00Z"
    assert hist[1]["after"]["start_at"] == "2026-11-05T06:45:00Z"
    assert hist[1]["changed"] == ["start_at"]
    assert hist[1]["actor"]["name"] == "Anna A"
    listed = c.get("/api/v1/entries?from=2026-11-05&to=2026-11-05").get_json()
    assert listed[0]["edited"] is True and listed[0]["corrected"] is False


def test_soft_delete_keeps_history(make_client, org):
    c = make_client("anna@example.com")
    e = c.post("/api/v1/entries", json={"start_at": local("2026-11-05", "08:00"),
                                        "end_at": local("2026-11-05", "12:00")}).get_json()
    assert c.delete(f"/api/v1/entries/{e['id']}").status_code == 200
    assert c.get("/api/v1/entries?from=2026-11-05&to=2026-11-05").get_json() == []
    deleted = c.get("/api/v1/entries?from=2026-11-05&to=2026-11-05&include_deleted=true").get_json()
    assert deleted[0]["deleted"] is True
    assert db.session.get(TimeEntry, e["id"]) is not None
    assert [h["action"] for h in c.get(f"/api/v1/entries/{e['id']}/history").get_json()] == ["create", "delete"]


def test_lead_correction_requires_reason_notifies_and_is_disputable(make_client, org, outbox):
    anna = make_client("anna@example.com")
    lead = make_client("lea@example.com")
    e = anna.post("/api/v1/entries", json={"start_at": local("2026-11-05", "08:00"),
                                           "end_at": local("2026-11-05", "12:00")}).get_json()
    r = lead.patch(f"/api/v1/entries/{e['id']}", json={"end_at": local("2026-11-05", "12:30")})
    assert r.status_code == 422
    r = lead.patch(f"/api/v1/entries/{e['id']}", json={"end_at": local("2026-11-05", "12:30"),
                                                       "reason": "Meeting ran late"})
    assert r.status_code == 200
    listed = anna.get("/api/v1/entries?from=2026-11-05&to=2026-11-05").get_json()
    assert listed[0]["corrected"] is True
    notes = anna.get("/api/v1/notifications").get_json()
    assert notes["unread"] == 1 and notes["items"][0]["kind"] == "entry_corrected"
    assert notes["items"][0]["payload"]["reason"] == "Meeting ran late"
    assert any(m.to == "anna@example.com" and m.meta["template"] == "entry_corrected" for m in outbox)
    hist = anna.get(f"/api/v1/entries/{e['id']}/history").get_json()
    assert hist[-1]["actor"]["name"] == "Lea Lead" and hist[-1]["reason"] == "Meeting ran late"
    # dispute
    r = anna.post(f"/api/v1/entries/{e['id']}/dispute", json={"message": "I left at 12:00"})
    assert r.status_code == 200
    assert lead.get("/api/v1/notifications").get_json()["items"][0]["kind"] == "entry_disputed"
    assert lead.post(f"/api/v1/entries/{e['id']}/dispute", json={"message": "x"}).status_code == 403


def test_lead_can_add_entry_for_member(make_client, org):
    lead = make_client("lea@example.com")
    r = lead.post("/api/v1/entries", json={"user_id": org["anna"].id, "start_at": local("2026-11-04", "08:00"),
                                           "end_at": local("2026-11-04", "12:00"), "reason": "Paper timesheet"})
    assert r.status_code == 201
    assert r.get_json()["corrected"] is True


def test_lead_cannot_touch_other_team(make_client, org):
    carl = make_client("carl@example.com")
    lead = make_client("lea@example.com")
    e = carl.post("/api/v1/entries", json={"start_at": local("2026-11-05", "08:00"),
                                           "end_at": local("2026-11-05", "12:00")}).get_json()
    assert lead.patch(f"/api/v1/entries/{e['id']}", json={"note": "x", "reason": "x"}).status_code == 404
    r = lead.post("/api/v1/entries", json={"user_id": org["carl"].id, "start_at": local("2026-11-04", "08:00"),
                                           "end_at": local("2026-11-04", "12:00"), "reason": "x"})
    assert r.status_code == 404


def test_employee_cannot_change_colleague(make_client, org):
    anna = make_client("anna@example.com")
    ben = make_client("ben@example.com")
    e = anna.post("/api/v1/entries", json={"start_at": local("2026-11-05", "08:00"),
                                           "end_at": local("2026-11-05", "12:00")}).get_json()
    assert ben.patch(f"/api/v1/entries/{e['id']}", json={"note": "hacked", "reason": "x"}).status_code == 404
    assert ben.delete(f"/api/v1/entries/{e['id']}").status_code == 404
    assert ben.get(f"/api/v1/entries/{e['id']}/history").status_code == 404
    r = ben.post("/api/v1/entries", json={"user_id": org["anna"].id, "start_at": local("2026-11-04", "08:00"),
                                          "end_at": local("2026-11-04", "12:00"), "reason": "x"})
    assert r.status_code == 404


def test_admin_can_correct_anyone(make_client, org):
    carl = make_client("carl@example.com")
    admin = make_client("admin@example.com")
    e = carl.post("/api/v1/entries", json={"start_at": local("2026-11-05", "08:00"),
                                           "end_at": local("2026-11-05", "12:00")}).get_json()
    assert admin.patch(f"/api/v1/entries/{e['id']}", json={"note": "ok", "reason": "check"}).status_code == 200


def test_clock_refused_outside_employment(make_client, org):
    admin = make_client("admin@example.com")
    anna = make_client("anna@example.com")
    assert admin.patch(f"/api/v1/users/{org['anna'].id}", json={"employment_end": "2026-10-31"}).status_code == 200
    r = anna.post("/api/v1/clock/start", json={})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "employment_ended"
    assert anna.get("/api/v1/entries?from=2026-10-01&to=2026-10-31").status_code == 200  # reading still works


def test_only_one_open_entry_per_user(app, org):
    """Database-level guarantee against concurrent clock-ins (partial unique index)."""
    import sqlalchemy as sa

    from resorixtrack.models import TimeEntry

    uid = org["anna"].id
    db.session.add(TimeEntry(user_id=uid, kind="work", start_at=DEFAULT_NOW, end_at=None, tz="Europe/Zurich"))
    db.session.commit()
    db.session.add(TimeEntry(user_id=uid, kind="work", start_at=DEFAULT_NOW + timedelta(hours=1), end_at=None,
                             tz="Europe/Zurich"))
    with pytest.raises(sa.exc.IntegrityError):
        db.session.commit()
    db.session.rollback()


def test_deactivation_stops_running_clock(make_client, org):
    anna = make_client("anna@example.com")
    admin = make_client("admin@example.com")
    assert anna.post("/api/v1/clock/start", json={}).get_json()["state"] == "working"
    assert admin.patch(f"/api/v1/users/{org['anna'].id}", json={"is_active": False}).status_code == 200
    from resorixtrack.models import TimeEntry

    open_entries = db.session.scalar(db.select(db.func.count(TimeEntry.id)).where(
        TimeEntry.user_id == org["anna"].id, TimeEntry.end_at.is_(None), TimeEntry.is_deleted.is_(False)))
    assert open_entries == 0


def test_every_entry_write_creates_a_revision(make_client, org):
    anna = make_client("anna@example.com")
    lead = make_client("lea@example.com")
    anna.post("/api/v1/clock/start", json={})
    freeze(DEFAULT_NOW + timedelta(minutes=30))
    anna.post("/api/v1/clock/break", json={})
    freeze(DEFAULT_NOW + timedelta(minutes=40))
    anna.post("/api/v1/clock/stop", json={})
    e = anna.post("/api/v1/entries", json={"start_at": local("2026-11-05", "07:00"),
                                           "end_at": local("2026-11-05", "08:00")}).get_json()
    lead.patch(f"/api/v1/entries/{e['id']}", json={"note": "n", "reason": "r"})
    anna.delete(f"/api/v1/entries/{e['id']}")
    entries = db.session.scalars(db.select(TimeEntry)).all()
    for te in entries:
        revs = db.session.scalars(db.select(Revision).where(Revision.entity == "time_entry",
                                                            Revision.entity_id == te.id)).all()
        assert revs, f"entry {te.id} has no revision"
        assert revs[-1].after["end_at"] == (te.end_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
                                            if te.end_at else None)


def test_days_endpoint(make_client, org):
    anna = make_client("anna@example.com")
    anna.post("/api/v1/entries", json={"start_at": local("2026-11-02", "08:00"), "end_at": local("2026-11-02", "12:00"),
                                       "reason": "x"})
    anna.post("/api/v1/entries", json={"start_at": local("2026-11-02", "12:30"), "end_at": local("2026-11-02", "16:54"),
                                       "reason": "x"})
    days = anna.get("/api/v1/days?from=2026-11-01&to=2026-11-07").get_json()
    mon = next(d for d in days["days"] if d["date"] == "2026-11-02")
    assert mon["worked_min"] == 504 and mon["delta_min"] == 0 and mon["edited"] is True
    sun = next(d for d in days["days"] if d["date"] == "2026-11-01")
    assert sun["holiday"]["name"] == "All Saints' Day" and sun["target_min"] == 0
    fri = next(d for d in days["days"] if d["date"] == "2026-11-06")
    assert fri["is_future"]


def test_balance_and_statement(make_client, org):
    anna = make_client("anna@example.com")
    bal = anna.get(f"/api/v1/accounts/{org['anna'].id}/balance").get_json()
    # nothing recorded since 1 Jan -> deficit equals all target time through yesterday
    assert bal["time"]["balance_min"] < 0
    st = anna.get(f"/api/v1/accounts/{org['anna'].id}/time?year=2026").get_json()
    assert st["opening_min"] == 0
    assert len(st["months"]) == 11
    jan = st["months"][0]
    # Jan 2026: 22 weekdays, New Year's Day holiday (Fribourg has no 2 Jan) -> 21 workdays x 504
    assert jan["target_min"] == 21 * 504
    # Nov: All Saints' Day falls on a Sunday -> no effect; statement covers days up to today
    assert st["months"][-1]["month"] == 11
    assert st["closing_min"] == bal["time"]["balance_min"]


def test_opening_balance_adjustment(make_client, org):
    admin = make_client("admin@example.com")
    anna = make_client("anna@example.com")
    before = anna.get(f"/api/v1/accounts/{org['anna'].id}/balance").get_json()["time"]["balance_min"]
    r = admin.post(f"/api/v1/accounts/{org['anna'].id}/adjustments",
                   json={"account": "time", "amount": 600, "kind": "opening", "reason": "Carry-over from old system",
                         "effective_date": "2026-01-01"})
    assert r.status_code == 201
    after = anna.get(f"/api/v1/accounts/{org['anna'].id}/balance").get_json()["time"]["balance_min"]
    assert after == before + 600
    assert anna.post(f"/api/v1/accounts/{org['anna'].id}/adjustments",
                     json={"account": "time", "amount": 600, "reason": "gift"}).status_code == 403
    assert anna.get("/api/v1/notifications").get_json()["items"][0]["kind"] == "balance_adjusted"


def test_running_clock_not_double_counted_future(make_client, org):
    anna = make_client("anna@example.com")
    anna.post("/api/v1/clock/start", json={"at": datetime(2026, 11, 5, 7, 0, tzinfo=UTC).isoformat()})
    s = anna.get("/api/v1/me/summary").get_json()
    assert s["today"]["running"] is True
    assert s["today"]["worked_min"] == 420
    assert s["clock"]["state"] == "working"


def test_start_stop_within_one_second_is_editable(make_client, org):
    c = make_client("anna@example.com")
    c.post("/api/v1/clock/start", json={})
    s = c.post("/api/v1/clock/stop", json={}).get_json()  # same frozen instant
    assert s["state"] == "idle"
    e = c.get("/api/v1/entries?from=2026-11-05&to=2026-11-05").get_json()[0]
    assert e["end_at"] > e["start_at"]
    assert c.patch(f"/api/v1/entries/{e['id']}", json={"note": "just a note"}).status_code == 200


def test_rapid_clicks_within_one_second(make_client, org):
    c = make_client("anna@example.com")
    for action, state in (("start", "working"), ("break", "on_break"), ("resume", "working"), ("stop", "idle")):
        r = c.post(f"/api/v1/clock/{action}", json={})
        assert r.status_code == 200 and r.get_json()["state"] == state, r.get_json()
    entries = c.get("/api/v1/entries?from=2026-11-05&to=2026-11-05").get_json()
    assert [e["kind"] for e in entries] == ["work", "break", "work"]
    for a, b in zip(entries, entries[1:], strict=False):
        assert a["end_at"] <= b["start_at"]
    # and immediately starting again works too
    assert c.post("/api/v1/clock/start", json={}).get_json()["state"] == "working"
