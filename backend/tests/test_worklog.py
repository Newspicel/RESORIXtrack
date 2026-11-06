# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Work log (what was done while clocked in) and projects."""

from __future__ import annotations

from conftest import PASSWORD, make_user  # noqa: F401

from resorixtrack.extensions import db
from resorixtrack.models import Revision
from resorixtrack.services import settings as st


def local(day: str, hm: str) -> str:
    return f"{day}T{hm}:00"


def work(client, day="2026-11-04", start="08:00", end="12:00"):
    r = client.post("/api/v1/entries", json={"start_at": local(day, start), "end_at": local(day, end), "reason": "x"})
    assert r.status_code == 201, r.get_json()


def test_projects_visibility_and_management(make_client, org):
    admin, lead, anna, carl = (make_client(e) for e in ("admin@example.com", "lea@example.com", "anna@example.com", "carl@example.com"))
    # employees can't create; leads only for their team; admins company-wide
    assert anna.post("/api/v1/projects", json={"name": "Nope"}).status_code == 403
    assert lead.post("/api/v1/projects", json={"name": "Company-wide by lead"}).status_code == 403
    assert lead.post("/api/v1/projects", json={"name": "Team B thing", "team_id": org["team_b"].id}).status_code == 403
    pa = lead.post("/api/v1/projects", json={"name": "Antenna tuner", "code": "AT2", "team_id": org["team_a"].id, "color": "#ff8800"})
    assert pa.status_code == 201, pa.get_json()
    pc = admin.post("/api/v1/projects", json={"name": "Internal"})
    assert pc.status_code == 201 and pc.get_json()["team_id"] is None
    pb = admin.post("/api/v1/projects", json={"name": "Team B only", "team_id": org["team_b"].id}).get_json()
    assert admin.post("/api/v1/projects", json={"name": "Antenna tuner"}).status_code == 409
    # visibility: Anna (team A) sees A + company-wide, not B; Carl (team B) sees B + company-wide
    assert {p["name"] for p in anna.get("/api/v1/projects").get_json()} == {"Antenna tuner", "Internal"}
    assert {p["name"] for p in carl.get("/api/v1/projects").get_json()} == {"Team B only", "Internal"}
    assert {p["name"] for p in admin.get("/api/v1/projects").get_json()} == {"Antenna tuner", "Internal", "Team B only"}
    # deactivate: hidden from pickers, visible with include_inactive, logged
    assert lead.patch(f"/api/v1/projects/{pa.get_json()['id']}", json={"is_active": False}).status_code == 200
    assert {p["name"] for p in anna.get("/api/v1/projects").get_json()} == {"Internal"}
    assert any(p["name"] == "Antenna tuner" and not p["is_active"] for p in anna.get("/api/v1/projects?include_inactive=1").get_json())
    assert lead.patch(f"/api/v1/projects/{pb['id']}", json={"is_active": False}).status_code == 403
    assert db.session.scalar(db.select(db.func.count(Revision.id)).where(Revision.entity == "project")) == 4


def test_worklog_crud_coverage_and_permissions(app, make_client, org):
    admin, lead, anna, ben = (make_client(e) for e in ("admin@example.com", "lea@example.com", "anna@example.com", "ben@example.com"))
    project = admin.post("/api/v1/projects", json={"name": "Internal"}).get_json()
    work(anna)  # 4 h on Wed 4 Nov
    # optional mode (default): no requirement, items can be added
    assert anna.get("/api/v1/me").get_json()["worklog"] == {"mode": "optional", "percent": 80, "project_required": False}
    r = anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 90, "note": "Lab measurements"})
    assert r.status_code == 201, r.get_json()
    item = r.get_json()
    assert item["project"] is None and item["minutes"] == 90
    r = anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 60, "project_id": project["id"], "note": ""})
    assert r.status_code == 201 and r.get_json()["project"]["name"] == "Internal"
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 30, "note": ""}).status_code == 422  # neither note nor project
    assert anna.post("/api/v1/worklog", json={"date": "2026-12-24", "minutes": 30, "note": "future"}).status_code == 422
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 0, "note": "x"}).status_code == 422
    day = next(d for d in anna.get("/api/v1/days?from=2026-11-04&to=2026-11-04").get_json()["days"])
    assert day["worklog_min"] == 150 and day["worklog_required_min"] == 0 and day["worklog_ok"] is True
    # edit / delete are logged; others can't see or touch
    assert ben.get(f"/api/v1/worklog?from=2026-11-01&to=2026-11-30&user_id={org['anna'].id}").status_code == 404
    assert ben.patch(f"/api/v1/worklog/{item['id']}", json={"minutes": 10}).status_code == 404
    assert lead.get(f"/api/v1/worklog?from=2026-11-01&to=2026-11-30&user_id={org['anna'].id}").get_json()["items"][0]["note"] == "Lab measurements"
    assert lead.patch(f"/api/v1/worklog/{item['id']}", json={"minutes": 120, "reason": "corrected"}).status_code == 200
    assert anna.delete(f"/api/v1/worklog/{item['id']}", json={}).status_code == 200
    actions = [r_.action for r_ in db.session.scalars(db.select(Revision).where(Revision.entity == "work_log").order_by(Revision.id))]
    assert actions == ["create", "create", "update", "delete"]
    assert len(anna.get("/api/v1/worklog?from=2026-11-01&to=2026-11-30").get_json()["items"]) == 1
    # lead can add for a member; switched off -> refused
    assert lead.post("/api/v1/worklog", json={"user_id": org["anna"].id, "date": "2026-11-04", "minutes": 30, "note": "by lead"}).status_code == 201
    st.update({"worklog_mode": "off"})
    db.session.commit()
    r = anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 30, "note": "x"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "worklog_off"


def test_required_mode_blocks_signoff_until_covered(app, make_client, org):
    admin, lead, anna = (make_client(e) for e in ("admin@example.com", "lea@example.com", "anna@example.com"))
    st.update({"worklog_mode": "required", "worklog_required_percent": 80, "worklog_project_required": True})
    db.session.commit()
    project = admin.post("/api/v1/projects", json={"name": "Internal"}).get_json()
    work(anna, "2026-10-15", "08:00", "12:00")  # 240 min in a finished month
    # project required
    assert anna.post("/api/v1/worklog", json={"date": "2026-10-15", "minutes": 200, "note": "no project"}).status_code == 422
    day = next(d for d in anna.get("/api/v1/days?from=2026-10-15&to=2026-10-15").get_json()["days"])
    assert day["worklog_required_min"] == 192 and day["worklog_ok"] is False
    ov = lead.get("/api/v1/signoffs/overview?month=2026-10").get_json()["rows"]
    row = next(r for r in ov if r["user"]["id"] == org["anna"].id)
    assert "worklog_incomplete" in row["blockers"]
    r = lead.post("/api/v1/signoffs", json={"user_ids": [org["anna"].id], "month": "2026-10"})
    assert r.status_code == 409, r.get_json()
    assert "worklog_incomplete" in str(r.get_json())
    # 150 min is not enough (62 %), 200 min is
    assert anna.post("/api/v1/worklog", json={"date": "2026-10-15", "minutes": 150, "project_id": project["id"], "note": "tuning"}).status_code == 201
    assert next(d for d in anna.get("/api/v1/days?from=2026-10-15&to=2026-10-15").get_json()["days"])["worklog_ok"] is False
    assert anna.post("/api/v1/worklog", json={"date": "2026-10-15", "minutes": 50, "project_id": project["id"], "note": "docs"}).status_code == 201
    assert next(d for d in anna.get("/api/v1/days?from=2026-10-15&to=2026-10-15").get_json()["days"])["worklog_ok"] is True
    r = lead.post("/api/v1/signoffs", json={"user_ids": [org["anna"].id], "month": "2026-10"})
    assert r.status_code in (200, 201), r.get_json()
    # signed off: the work log of that month is read-only, in the API and in the database
    r = anna.post("/api/v1/worklog", json={"date": "2026-10-15", "minutes": 10, "project_id": project["id"], "note": "late"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "period_signed_off"
    import pytest
    from sqlalchemy import text
    from sqlalchemy.exc import DatabaseError

    with pytest.raises(DatabaseError):
        db.session.execute(text("UPDATE work_logs SET minutes = 1 WHERE user_id = :u"), {"u": org["anna"].id})
        db.session.commit()
    db.session.rollback()
    # today is never flagged (the day is not over)
    work(anna, "2026-11-05", "08:00", "11:00")
    assert next(d for d in anna.get("/api/v1/days?from=2026-11-05&to=2026-11-05").get_json()["days"])["worklog_ok"] is True


def test_project_report_and_timesheet_include_work_log(make_client, org):
    admin, lead, anna = (make_client(e) for e in ("admin@example.com", "lea@example.com", "anna@example.com"))
    p1 = admin.post("/api/v1/projects", json={"name": "Internal", "code": "INT"}).get_json()
    p2 = lead.post("/api/v1/projects", json={"name": "Antenna tuner", "team_id": org["team_a"].id}).get_json()
    work(anna)
    anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 90, "project_id": p2["id"], "note": "tuning"})
    anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 30, "project_id": p1["id"]})
    anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 15, "note": "misc"})
    rep = lead.get("/api/v1/reports/projects?from=2026-11-01&to=2026-11-30&format=json").get_json()
    assert rep["total_min"] == 135
    names = [p["name"] for p in rep["projects"]]
    assert names == ["Antenna tuner", "Internal", None]
    assert rep["projects"][0]["people"][0]["name"] == "Anna A" and rep["projects"][0]["people"][0]["minutes"] == 90
    for fmt in ("pdf", "xlsx", "csv"):
        assert lead.get(f"/api/v1/reports/projects?from=2026-11-01&to=2026-11-30&format={fmt}").status_code == 200, fmt
    # employees only see their own figures
    mine = anna.get("/api/v1/reports/projects?from=2026-11-01&to=2026-11-30&format=json").get_json()
    assert [p["name"] for p in mine["people"]] == ["Anna A"]
    ts = anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=json").get_json()
    assert ts["worklog"]["2026-11-04"][0]["project"] == "Antenna tuner"
    assert anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=pdf").status_code == 200
    csv = anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=csv").data.decode("utf-8-sig")
    assert "Antenna tuner: tuning (1.5 h)" in csv


def test_project_code_is_text_or_number_up_to_30_characters(make_client, org):
    admin = make_client("admin@example.com")
    assert admin.post("/api/v1/projects", json={"name": "Too long", "code": "1234567890123456789012345678901"}).status_code == 422
    r = admin.post("/api/v1/projects", json={"name": "Thirty", "code": "123456789012345678901234567890"})
    assert r.status_code == 201 and r.get_json()["code"] == "123456789012345678901234567890"
    r = admin.post("/api/v1/projects", json={"name": "Numeric", "code": "4711"})
    assert r.status_code == 201 and r.get_json()["code"] == "4711"
    r = admin.post("/api/v1/projects", json={"name": "Mixed", "code": "ab-12.Cd"})
    assert r.status_code == 201 and r.get_json()["code"] == "ab-12.Cd"


def test_timed_items_derive_the_duration_and_must_not_overlap(make_client, org):
    anna = make_client("anna@example.com")
    work(anna)
    r = anna.post("/api/v1/worklog", json={"date": "2026-11-04", "start_time": "09:00", "end_time": "11:30", "note": "Measurements"})
    assert r.status_code == 201, r.get_json()
    it = r.get_json()
    assert it["minutes"] == 150 and it["start_time"] == "09:00" and it["end_time"] == "11:30"
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-04", "start_time": "12:00", "end_time": "11:00", "note": "x"}).status_code == 422
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-04", "start_time": "12:00", "note": "x"}).status_code == 422
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-04", "start_time": "12:00", "end_time": "13:00", "minutes": 30, "note": "x"}).status_code == 422
    r = anna.post("/api/v1/worklog", json={"date": "2026-11-04", "start_time": "11:00", "end_time": "12:00", "note": "overlap"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "worklog_overlap"
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-04", "start_time": "11:30", "end_time": "12:00", "note": "adjacent"}).status_code == 201
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-05", "start_time": "11:00", "end_time": "12:00", "note": "other day"}).status_code == 201
    # a duration that contradicts the times is refused; clearing the times allows a plain duration again
    assert anna.patch(f"/api/v1/worklog/{it['id']}", json={"minutes": 100}).status_code == 422
    r = anna.patch(f"/api/v1/worklog/{it['id']}", json={"start_time": None, "end_time": None, "minutes": 100})
    assert r.status_code == 200 and r.get_json()["minutes"] == 100 and r.get_json()["start_time"] is None
    r = anna.patch(f"/api/v1/worklog/{it['id']}", json={"start_time": "08:00", "end_time": "08:45"})
    assert r.status_code == 200 and r.get_json()["minutes"] == 45
    # the change history and the timesheet carry the times
    rev = db.session.scalars(db.select(Revision).where(Revision.entity == "work_log", Revision.action == "update").order_by(Revision.id.desc())).first()
    assert rev.after["start_time"] == "08:00" and rev.before["start_time"] is None
    sheet = anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=json").get_json()
    assert {(w["start"], w["end"], w["minutes"]) for w in sheet["worklog"]["2026-11-04"]} == {("08:00", "08:45", 45), ("11:30", "12:00", 30)}
    csv = anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=csv").get_data(as_text=True)
    assert "08:00–08:45 Measurements" in csv


def test_customer_reference_instead_of_a_project(make_client, org):
    admin, lead, anna = (make_client(e) for e in ("admin@example.com", "lea@example.com", "anna@example.com"))
    project = admin.post("/api/v1/projects", json={"name": "Internal"}).get_json()
    work(anna)
    r = anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 60, "customer_ref": " 4711 ", "note": "Site visit"})
    assert r.status_code == 201, r.get_json()
    item = r.get_json()
    assert item["customer_ref"] == "4711" and item["project"] is None
    # a reference alone is enough (no note needed); project and reference are exclusive
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 30, "customer_ref": "K-0815"}).status_code == 201
    r = anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 30, "customer_ref": "4711", "project_id": project["id"]})
    assert r.status_code == 422 and "customer_ref" in r.get_json()["error"]["fields"]
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 30, "customer_ref": "x" * 61}).status_code == 422
    # "project required" is satisfied by a customer reference
    st.update({"worklog_project_required": True})
    db.session.commit()
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 10, "note": "no ref"}).status_code == 422
    assert anna.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 10, "customer_ref": "4711"}).status_code == 201
    st.update({"worklog_project_required": False})
    db.session.commit()
    # switching an item from a reference to a project and back is logged
    r = anna.patch(f"/api/v1/worklog/{item['id']}", json={"project_id": project["id"], "customer_ref": ""})
    assert r.status_code == 200 and r.get_json()["project"]["name"] == "Internal" and r.get_json()["customer_ref"] == ""
    rev = db.session.scalars(db.select(Revision).where(Revision.entity == "work_log", Revision.action == "update").order_by(Revision.id.desc())).first()
    assert rev.before["customer_ref"] == "4711" and rev.after["customer_ref"] == ""
    # suggestions: own recent references, most recent first, nobody else's
    assert anna.get("/api/v1/worklog/customer-refs").get_json() == ["4711", "K-0815"]
    assert lead.get("/api/v1/worklog/customer-refs").get_json() == []
    # the project report groups by customer reference, the timesheet prints it
    rep = lead.get("/api/v1/reports/projects?from=2026-11-01&to=2026-11-30&format=json").get_json()
    groups = {(p["kind"], p["name"]): p["minutes"] for p in rep["projects"]}
    assert groups == {("customer", "4711"): 10, ("customer", "K-0815"): 30, ("project", "Internal"): 60}
    for fmt in ("pdf", "xlsx", "csv"):
        assert lead.get(f"/api/v1/reports/projects?from=2026-11-01&to=2026-11-30&format={fmt}").status_code == 200, fmt
    csv = anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=csv").get_data(as_text=True)
    assert "K-0815 (0.5 h)" in csv and "Internal: Site visit (1.0 h)" in csv
