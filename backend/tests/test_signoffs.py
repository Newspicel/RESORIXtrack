# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Monthly sign-off: permissions, preconditions, immutability on every layer, reopen, tamper evidence."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DatabaseError

from resorixtrack import db_guards
from resorixtrack.extensions import db
from resorixtrack.models import MonthSignoff, Revision, TimeEntry
from resorixtrack.services import signoffs

# DEFAULT_NOW = Thu 2026-11-05 -> October 2026 is the previous, complete month.


def _october_entry(c, day="2026-10-14", start="08:00", end="12:00"):
    r = c.post("/api/v1/entries", json={"start_at": f"{day}T{start}:00", "end_at": f"{day}T{end}:00",
                                        "reason": "paper timesheet"})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def _sign(c, user_ids, month="2026-10", note=""):
    return c.post("/api/v1/signoffs", json={"month": month, "user_ids": user_ids, "note": note})


@pytest.fixture
def signed(make_client, org):
    """Anna has an October entry, a lead correction and an adjustment; Lea (lead) signs October off."""
    anna = make_client("anna@example.com")
    lead = make_client("lea@example.com")
    e = _october_entry(anna)
    r = _sign(lead, [org["anna"].id], note="checked")
    assert r.status_code == 201, r.get_json()
    res = r.get_json()["results"][0]
    assert res["ok"], res
    return {"anna": anna, "lead": lead, "entry": e, "signoff": res["signoff"]}


# --------------------------------------------------------------------------- permissions & preconditions

def test_lead_signs_off_member(signed, org):
    so = signed["signoff"]
    assert so["month"] == "2026-10" and so["active"] and so["signed_by"]["name"] == "Lea Lead"
    assert so["snapshot"]["worked_min"] == 240
    assert len(so["digest"]) == 64
    notes = signed["anna"].get("/api/v1/notifications").get_json()["items"]
    assert notes[0]["kind"] == "month_signed_off"


def test_who_may_sign(make_client, org):
    anna = make_client("anna@example.com")
    lead = make_client("lea@example.com")
    admin = make_client("admin@example.com")
    r = _sign(anna, [org["ben"].id]).get_json()["results"][0]
    assert not r["ok"] and r["error"]["code"] == "not_found"  # not even visible
    assert _sign(anna, [org["anna"].id]).get_json()["results"][0]["error"]["code"] == "forbidden"
    assert _sign(lead, [org["carl"].id]).get_json()["results"][0]["error"]["code"] == "not_found"
    assert _sign(lead, [org["lead"].id]).get_json()["results"][0]["error"]["code"] == "forbidden"  # own month
    r = _sign(admin, [org["lead"].id, org["carl"].id]).get_json()["results"]
    assert all(x["ok"] for x in r)


def test_preconditions(make_client, org):
    lead = make_client("lea@example.com")
    anna = make_client("anna@example.com")
    r = _sign(lead, [org["anna"].id], month="2026-11").get_json()["results"][0]
    assert r["error"]["code"] == "month_not_complete"
    anna.post("/api/v1/absences", json={"type": "vacation", "start_date": "2026-10-20"})  # pending
    r = _sign(lead, [org["anna"].id]).get_json()["results"][0]
    assert r["error"]["code"] == "pending_absence"
    assert _sign(lead, [org["ben"].id]).get_json()["results"][0]["ok"]
    assert _sign(lead, [org["ben"].id]).get_json()["results"][0]["error"]["code"] == "already_signed"


def test_overview(make_client, org):
    lead = make_client("lea@example.com")
    ov = lead.get("/api/v1/signoffs/overview?month=2026-10").get_json()
    rows = {r["user"]["id"]: r for r in ov["rows"]}
    assert set(rows) == {org["lead"].id, org["anna"].id, org["ben"].id}
    assert rows[org["anna"].id]["can_sign"] and not rows[org["lead"].id]["can_sign"]
    assert make_client("anna@example.com").get("/api/v1/signoffs/overview").status_code == 403


# --------------------------------------------------------------------------- layer 1: API / services

def test_signed_month_is_read_only_for_everyone(signed, make_client, org):
    anna, lead = signed["anna"], signed["lead"]
    admin = make_client("admin@example.com")
    eid = signed["entry"]["id"]
    for c in (anna, lead, admin):
        r = c.patch(f"/api/v1/entries/{eid}", json={"note": "x", "reason": "x"})
        assert r.status_code == 409 and r.get_json()["error"]["code"] == "period_signed_off", r.get_json()
        assert c.delete(f"/api/v1/entries/{eid}", json={"reason": "x"}).status_code == 409
    r = anna.post("/api/v1/entries", json={"start_at": "2026-10-15T08:00:00", "end_at": "2026-10-15T09:00:00",
                                           "reason": "late"})
    assert r.status_code == 409
    # entries spanning into the signed month (night shift 31 Oct -> 1 Nov) are blocked too
    r = anna.post("/api/v1/entries", json={"start_at": "2026-10-31T22:00:00", "end_at": "2026-11-01T02:00:00",
                                           "reason": "night"})
    assert r.status_code == 409
    # November stays editable
    assert anna.post("/api/v1/entries", json={"start_at": "2026-11-02T08:00:00", "end_at": "2026-11-02T09:00:00",
                                              "reason": "x"}).status_code == 201


def test_absences_adjustments_schedules_holidays_blocked(signed, make_client, org):
    anna, lead = signed["anna"], signed["lead"]
    admin = make_client("admin@example.com")
    aid = org["anna"].id
    assert anna.post("/api/v1/absences", json={"type": "sick", "start_date": "2026-10-20"}).status_code in (409, 422)
    r = lead.post("/api/v1/absences", json={"user_id": aid, "type": "sick", "start_date": "2026-10-20"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "period_signed_off"
    # an absence spanning Oct/Nov
    r = lead.post("/api/v1/absences", json={"user_id": aid, "type": "vacation", "start_date": "2026-10-30",
                                            "end_date": "2026-11-03"})
    assert r.status_code == 409
    r = admin.post(f"/api/v1/accounts/{aid}/adjustments", json={"account": "time", "amount": 60, "reason": "x",
                                                                "effective_date": "2026-10-10"})
    assert r.status_code == 409
    r = admin.post(f"/api/v1/users/{aid}/schedules", json={"valid_from": "2026-10-01", "minutes": {"mon": 480}})
    assert r.status_code == 409
    assert admin.post(f"/api/v1/users/{aid}/schedules", json={"valid_from": "2026-11-01",
                                                              "minutes": {"mon": 480}}).status_code == 201
    assert admin.patch(f"/api/v1/users/{aid}", json={"employment_start": "2026-10-15"}).status_code == 409
    cal = admin.get("/api/v1/holiday-calendars").get_json()[0]["id"]
    r = admin.post(f"/api/v1/holiday-calendars/{cal}/holidays", json={"date": "2026-10-16", "name": "Late add"})
    assert r.status_code == 409
    assert admin.post(f"/api/v1/holiday-calendars/{cal}/holidays",
                      json={"date": "2026-11-16", "name": "Future"}).status_code == 201


def test_backdated_clock_into_signed_month_blocked(app, signed, org):
    from datetime import UTC, datetime

    from resorixtrack.timeutil import freeze

    freeze(datetime(2026, 11, 1, 0, 30, tzinfo=UTC))  # 01:30 Zurich on 1 Nov
    r = signed["anna"].post("/api/v1/clock/start", json={"at": "2026-10-31T22:30:00Z"})  # 23:30 on 31 Oct
    assert r.status_code == 409


# --------------------------------------------------------------------------- layer 2: database triggers

def _raw(sql: str, **params):
    with pytest.raises(DatabaseError) as exc:
        db.session.execute(text(sql), params)
        db.session.flush()
    db.session.rollback()
    return db_guards.is_guard_error(exc.value)


def test_triggers_block_direct_sql(signed, org):
    eid = signed["entry"]["id"]
    aid = org["anna"].id
    assert _raw("UPDATE time_entries SET end_at = '2026-10-14 12:00:00.000000' WHERE id = :i", i=eid) == "period_signed_off"
    assert _raw("DELETE FROM time_entries WHERE id = :i", i=eid) == "period_signed_off"
    assert _raw("INSERT INTO time_entries (user_id, kind, start_at, end_at, tz, note, source, is_deleted, created_at, "
                "updated_at) VALUES (:u, 'work', '2026-10-20 06:00:00.000000', '2026-10-20 07:00:00.000000', "
                "'Europe/Zurich', '', 'manual', 0, '2026-11-05 00:00:00', '2026-11-05 00:00:00')", u=aid) == "period_signed_off"
    assert _raw("INSERT INTO balance_adjustments (user_id, account, amount, effective_date, kind, reason, is_deleted, "
                "created_at) VALUES (:u, 'time', 999, '2026-10-05', 'correction', 'x', 0, '2026-11-05')", u=aid) == "period_signed_off"
    assert _raw("UPDATE work_schedules SET minutes_mon = 1 WHERE user_id = :u", u=aid) == "period_signed_off"
    assert _raw("UPDATE users SET employment_start = '2026-10-10' WHERE id = :u", u=aid) == "period_signed_off"
    assert _raw("DELETE FROM holidays WHERE date <= '2026-10-31'") == "period_signed_off"
    # the ORM path is guarded as well
    e = db.session.get(TimeEntry, eid)
    e.note = "sneaky"
    with pytest.raises(DatabaseError):
        db.session.commit()
    db.session.rollback()
    assert db.session.get(TimeEntry, eid).note == ""


def test_signoffs_and_change_log_are_immutable(signed):
    sid = signed["signoff"]["id"]
    assert _raw("DELETE FROM month_signoffs WHERE id = :i", i=sid) == "signoff_immutable"
    assert _raw("UPDATE month_signoffs SET snapshot = '{}' WHERE id = :i", i=sid) == "signoff_immutable"
    assert _raw("UPDATE month_signoffs SET signed_by_id = NULL WHERE id = :i", i=sid) == "signoff_immutable"
    assert _raw("UPDATE revisions SET reason = 'rewritten'") == "revisions_append_only"
    assert _raw("DELETE FROM revisions") == "revisions_append_only"


def test_trigger_errors_map_to_409(signed, app, org):
    """Even if a service check were missing, the database answers with a clean 409."""
    from unittest import mock

    with mock.patch("resorixtrack.services.signoffs.ensure_open_instants", lambda *a, **k: None):
        r = signed["anna"].patch(f"/api/v1/entries/{signed['entry']['id']}", json={"note": "x", "reason": "x"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "period_signed_off"


def test_migration_triggers_match_guards():
    import importlib.util
    from pathlib import Path

    path = next(Path(db_guards.__file__).parent.joinpath("migrations", "versions").glob("0001_*.py"))
    spec = importlib.util.spec_from_file_location("m0001", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    assert module.TRIGGERS == db_guards.TRIGGERS


def test_all_guards_installed(app):
    with db.engine.connect() as conn:
        present = db_guards.installed(conn)
    assert {n for n, _ in db_guards.TRIGGERS} <= set(present)


# --------------------------------------------------------------------------- reopen

def test_reopen_by_admin_only(signed, make_client, org):
    sid = signed["signoff"]["id"]
    lead, anna = signed["lead"], signed["anna"]
    admin = make_client("admin@example.com")
    assert lead.post(f"/api/v1/signoffs/{sid}/reopen", json={"reason": "x"}).status_code == 403
    assert admin.post(f"/api/v1/signoffs/{sid}/reopen", json={"reason": ""}).status_code == 422
    r = admin.post(f"/api/v1/signoffs/{sid}/reopen", json={"reason": "Missing customer visit"})
    assert r.status_code == 200 and not r.get_json()["active"]
    assert anna.get("/api/v1/notifications").get_json()["items"][0]["kind"] == "month_reopened"
    eid = signed["entry"]["id"]
    assert anna.patch(f"/api/v1/entries/{eid}", json={"note": "fixed", "reason": "after reopen"}).status_code == 200
    assert admin.post(f"/api/v1/signoffs/{sid}/reopen", json={"reason": "again"}).status_code == 409
    # sign off again -> new sealed record chained to the old one
    r = _sign(lead, [org["anna"].id]).get_json()["results"][0]
    assert r["ok"]
    rows = db.session.scalars(db.select(MonthSignoff).order_by(MonthSignoff.id)).all()
    assert rows[1].prev_seal == rows[0].seal
    actions = [x.action for x in db.session.scalars(db.select(Revision).where(Revision.entity == "signoff"))]
    assert actions == ["signoff", "reopen", "signoff"]


def test_days_endpoint_reports_locked_months(signed, org):
    d = signed["anna"].get("/api/v1/days?from=2026-10-01&to=2026-11-30").get_json()
    assert list(d["locked_months"]) == ["2026-10"]
    assert d["locked_months"]["2026-10"]["signed_by"] == "Lea Lead"


# --------------------------------------------------------------------------- layer 3: tamper evidence

def _drop_guards():
    for name, _ in db_guards.TRIGGERS:
        db.session.execute(text(f"DROP TRIGGER IF EXISTS {name}"))
    db.session.commit()


def test_verify_intact_then_detects_direct_db_tampering(signed, make_client, org):
    admin = make_client("admin@example.com")
    v = admin.get("/api/v1/signoffs/verify").get_json()
    assert v["ok"] and v["counts"]["intact"] == 1 and v["guards"]["missing"] == []
    # attacker with file access drops the triggers and edits a signed entry
    _drop_guards()
    db.session.execute(text("UPDATE time_entries SET end_at = '2026-10-14 15:00:00.000000' WHERE id = :i"),
                       {"i": signed["entry"]["id"]})
    db.session.commit()
    v = admin.get("/api/v1/signoffs/verify").get_json()
    assert not v["ok"] and v["counts"]["data_changed"] == 1
    assert len(v["guards"]["missing"]) == len(db_guards.TRIGGERS)
    assert v["problems"][0]["integrity"] == "data_changed"


def test_verify_detects_forged_snapshot_and_removed_signoff(signed, make_client, org):
    admin = make_client("admin@example.com")
    # a second sign-off for Anna (September) so there is a chain
    r = _sign(admin, [org["anna"].id], month="2026-09").get_json()["results"][0]
    assert r["ok"]
    _drop_guards()
    first = db.session.scalars(db.select(MonthSignoff).order_by(MonthSignoff.id)).first()
    db.session.execute(text("UPDATE month_signoffs SET snapshot = '{\"worked_min\": 99999}' WHERE id = :i"),
                       {"i": first.id})
    db.session.commit()
    v = admin.get("/api/v1/signoffs/verify").get_json()
    assert v["counts"]["seal_invalid"] == 1
    db.session.execute(text("DELETE FROM month_signoffs WHERE id = :i"), {"i": first.id})
    db.session.commit()
    v = admin.get("/api/v1/signoffs/verify").get_json()
    assert v["counts"]["chain_broken"] == 1


def test_signoff_appears_on_timesheet_pdf_data(signed):
    ts = signed["anna"].get("/api/v1/reports/timesheet?year=2026&month=10").get_json()
    assert ts["signoff"]["signed_by"] == "Lea Lead"
    assert signed["anna"].get("/api/v1/reports/timesheet?year=2026&month=10&format=pdf").status_code == 200


def test_migrate_reinstalls_missing_guards(tmp_path):
    from flask_migrate import upgrade

    from resorixtrack import create_app

    app = create_app("testing", overrides={"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'g.db'}",
                                           "DATA_DIR": tmp_path})
    with app.app_context():
        upgrade()
        db.session.execute(text("DROP TRIGGER trg_signoff_time_entries_upd"))
        db.session.commit()
        r = app.test_cli_runner().invoke(args=["resorixtrack", "migrate"])
        assert r.exit_code == 0 and "Re-installed 1 database guard" in r.output
        with db.engine.connect() as conn:
            assert "trg_signoff_time_entries_upd" in db_guards.installed(conn)
        db.engine.dispose()


_ = signoffs
