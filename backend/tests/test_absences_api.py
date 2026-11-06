# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
from __future__ import annotations

import io
from datetime import date

from conftest import make_user

from resorixtrack.extensions import db
from resorixtrack.models import Revision

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def vac(c, start, end=None, **kw):
    return c.post("/api/v1/absences", json={"type": "vacation", "start_date": start, "end_date": end or start, **kw})


# --------------------------------------------------------------------------- vacation workflow

def test_vacation_request_approve(make_client, org, outbox):
    anna = make_client("anna@example.com")
    lead = make_client("lea@example.com")
    r = vac(anna, "2026-12-14", "2026-12-18", note="Skiing")
    assert r.status_code == 201, r.get_json()
    a = r.get_json()
    assert a["status"] == "pending" and a["days"] == 5
    assert a["permissions"]["cancel"] and not a["permissions"]["decide"]
    # lead is notified by email + bell
    assert any(m.to == "lea@example.com" and m.meta["template"] == "absence_requested" for m in outbox)
    inbox = lead.get("/api/v1/absences/pending").get_json()
    assert [x["id"] for x in inbox] == [a["id"]]
    assert inbox[0]["permissions"]["decide"]
    vac_before = anna.get(f"/api/v1/accounts/{org['anna'].id}/vacation?year=2026").get_json()
    assert vac_before["pending"] == 5
    r = lead.post(f"/api/v1/absences/{a['id']}/approve", json={"note": "Enjoy!"})
    assert r.status_code == 200 and r.get_json()["status"] == "approved"
    assert r.get_json()["decided_by"]["name"] == "Lea Lead"
    vac_after = anna.get(f"/api/v1/accounts/{org['anna'].id}/vacation?year=2026").get_json()
    assert vac_after["planned"] == 5 and vac_after["pending"] == 0
    assert vac_after["remaining"] == vac_before["remaining"] - 5
    assert any(m.to == "anna@example.com" and m.meta["template"] == "absence_approved" for m in outbox)
    # cannot decide twice
    assert lead.post(f"/api/v1/absences/{a['id']}/reject", json={}).status_code == 409


def test_vacation_reject(make_client, org):
    anna = make_client("anna@example.com")
    lead = make_client("lea@example.com")
    a = vac(anna, "2026-12-14").get_json()
    r = lead.post(f"/api/v1/absences/{a['id']}/reject", json={"note": "Release week"})
    assert r.get_json()["status"] == "rejected"
    assert anna.get("/api/v1/notifications").get_json()["items"][0]["kind"] == "absence_rejected"


def test_vacation_days_skip_weekends_and_holidays(make_client, org):
    anna = make_client("anna@example.com")
    # 21-27 Dec 2026: Christmas (Fri 25 Dec) is a holiday in Fribourg; Sat/Sun excluded
    a = vac(anna, "2026-12-21", "2026-12-27").get_json()
    assert a["days"] == 4
    # half days
    a2 = vac(anna, "2026-12-28", "2026-12-29", start_half="pm", end_half="am").get_json()
    assert a2["days"] == 1


def test_overlapping_requests_rejected(make_client, org):
    anna = make_client("anna@example.com")
    vac(anna, "2026-12-14", "2026-12-18")
    r = vac(anna, "2026-12-16")
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "absence_overlap"
    # different halves on the same day are fine
    vac(anna, "2026-12-21", start_half="am")
    assert vac(anna, "2026-12-21", start_half="pm").status_code == 201


def test_weekend_only_request_rejected(make_client, org):
    anna = make_client("anna@example.com")
    r = vac(anna, "2026-12-12", "2026-12-13")
    assert r.status_code == 422 and r.get_json()["error"]["fields"]["end_date"] == "no_workdays"


def test_lead_cannot_approve_other_team_or_self(make_client, org):
    carl = make_client("carl@example.com")
    lead = make_client("lea@example.com")
    admin = make_client("admin@example.com")
    a = vac(carl, "2026-12-14").get_json()
    assert lead.post(f"/api/v1/absences/{a['id']}/approve", json={}).status_code == 404
    assert lead.get("/api/v1/absences/pending").get_json() == []
    # Team B has no lead -> admin decides
    assert [x["id"] for x in admin.get("/api/v1/absences/pending").get_json()] == [a["id"]]
    assert admin.post(f"/api/v1/absences/{a['id']}/approve", json={}).status_code == 200
    # lead's own request goes to admins, lead can't approve it
    own = vac(lead, "2026-12-21").get_json()
    assert lead.post(f"/api/v1/absences/{own['id']}/approve", json={}).status_code == 403
    assert own["id"] in [x["id"] for x in admin.get("/api/v1/absences/pending").get_json()]


def test_employee_cannot_approve(make_client, org):
    anna = make_client("anna@example.com")
    ben = make_client("ben@example.com")
    a = vac(anna, "2026-12-14").get_json()
    assert ben.post(f"/api/v1/absences/{a['id']}/approve", json={}).status_code == 404
    assert anna.post(f"/api/v1/absences/{a['id']}/approve", json={}).status_code == 403


def test_cancel_rules(make_client, org, outbox):
    anna = make_client("anna@example.com")
    lead = make_client("lea@example.com")
    # pending: employee can cancel
    a = vac(anna, "2026-12-14").get_json()
    assert anna.post(f"/api/v1/absences/{a['id']}/cancel", json={}).get_json()["status"] == "cancelled"
    # approved future: employee can cancel, lead is notified
    b = vac(anna, "2026-12-15").get_json()
    lead.post(f"/api/v1/absences/{b['id']}/approve", json={})
    assert anna.post(f"/api/v1/absences/{b['id']}/cancel", json={}).status_code == 200
    assert lead.get("/api/v1/notifications").get_json()["items"][0]["kind"] == "absence_cancelled"
    # approved, already started: only the lead can cancel, with a reason
    c = vac(anna, "2026-11-02", "2026-11-03", note="").get_json()
    lead.post(f"/api/v1/absences/{c['id']}/approve", json={})
    assert anna.post(f"/api/v1/absences/{c['id']}/cancel", json={}).status_code == 403
    assert lead.post(f"/api/v1/absences/{c['id']}/cancel", json={}).status_code == 422
    r = lead.post(f"/api/v1/absences/{c['id']}/cancel", json={"reason": "Came to work after all"})
    assert r.status_code == 200 and r.get_json()["cancel_reason"] == "Came to work after all"
    assert any(m.to == "anna@example.com" and m.meta["template"] == "absence_cancelled" for m in outbox)
    hist = anna.get(f"/api/v1/absences/{c['id']}/history").get_json()
    assert [h["action"] for h in hist] == ["create", "approve", "cancel"]


def test_lead_records_vacation_directly(make_client, org):
    lead = make_client("lea@example.com")
    r = lead.post("/api/v1/absences", json={"user_id": org["anna"].id, "type": "vacation", "start_date": "2026-12-14"})
    assert r.status_code == 201 and r.get_json()["status"] == "approved"


def test_preview(make_client, org):
    anna = make_client("anna@example.com")
    p = anna.get("/api/v1/absences/preview?start_date=2026-12-21&end_date=2026-12-31&type=vacation").get_json()
    assert p["days"] == 8  # 21-24, 28-31 (25 Dec holiday)
    assert p["vacation_after"] == p["vacation_remaining"] - 8


# --------------------------------------------------------------------------- sick reports

def test_employee_reports_sick_today(make_client, org, outbox):
    anna = make_client("anna@example.com")
    anna.post("/api/v1/clock/start", json={})
    from datetime import timedelta

    from conftest import DEFAULT_NOW

    from resorixtrack.timeutil import freeze

    freeze(DEFAULT_NOW + timedelta(minutes=5))
    assert anna.get("/api/v1/absences/sick-check").get_json() == {"allowed": True, "reason": None}
    r = anna.post("/api/v1/absences/sick-today", json={"note": "Fever"})
    assert r.status_code == 201, r.get_json()
    a = r.get_json()
    assert a["status"] == "approved" and a["type"]["key"] == "sick"
    assert anna.get("/api/v1/clock").get_json()["state"] == "idle"  # running clock stopped
    assert anna.get("/api/v1/absences/sick-check").get_json()["reason"] == "already_sick"
    assert any(m.to == "lea@example.com" and m.meta["template"] == "absence_reported" for m in outbox)


def test_sick_report_blocked_on_weekend_holiday_vacation(app, make_client, org):
    from resorixtrack.timeutil import freeze

    anna = make_client("anna@example.com")
    lead = make_client("lea@example.com")
    sick = {"type": "sick"}
    # weekend (Sat 7 Nov 2026)
    from datetime import UTC, datetime

    freeze(datetime(2026, 11, 7, 9, tzinfo=UTC))
    r = anna.post("/api/v1/absences", json={**sick, "start_date": "2026-11-07"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "not_a_workday"
    # public holiday (Tue 8 Dec 2026 Immaculate Conception in Fribourg)
    freeze(datetime(2026, 12, 8, 9, tzinfo=UTC))
    anna, lead = make_client("anna@example.com"), make_client("lea@example.com")  # 30-day sessions expired
    r = anna.post("/api/v1/absences", json={**sick, "start_date": "2026-12-08"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "public_holiday"
    # on approved vacation
    v = lead.post("/api/v1/absences", json={"user_id": org["anna"].id, "type": "vacation",
                                            "start_date": "2026-12-09"}).get_json()
    assert v["status"] == "approved"
    freeze(datetime(2026, 12, 9, 9, tzinfo=UTC))
    r = anna.post("/api/v1/absences", json={**sick, "start_date": "2026-12-09"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "on_vacation"
    # in advance
    r = anna.post("/api/v1/absences", json={**sick, "start_date": "2026-12-11"})
    assert r.status_code == 422 and r.get_json()["error"]["fields"]["start_date"] == "future"
    # backdated too far
    r = anna.post("/api/v1/absences", json={**sick, "start_date": "2026-12-01"})
    assert r.status_code == 422 and r.get_json()["error"]["fields"]["start_date"] == "too_old"


def test_lead_marks_member_sick_and_employee_extends(make_client, org, outbox):
    lead = make_client("lea@example.com")
    anna = make_client("anna@example.com")
    r = lead.post("/api/v1/absences", json={"user_id": org["anna"].id, "type": "sick", "start_date": "2026-11-02",
                                            "end_date": "2026-11-04"})
    assert r.status_code == 201 and r.get_json()["status"] == "approved"
    assert any(m.to == "anna@example.com" and m.meta["template"] == "absence_recorded" for m in outbox)
    assert anna.get("/api/v1/notifications").get_json()["items"][0]["kind"] == "absence_recorded"
    # lead cannot mark someone in another team
    assert lead.post("/api/v1/absences", json={"user_id": org["carl"].id, "type": "sick",
                                               "start_date": "2026-11-02"}).status_code == 404
    # accident can only be recorded by lead/admin
    assert anna.post("/api/v1/absences", json={"type": "accident", "start_date": "2026-11-05"}).status_code == 403


def test_employee_can_extend_own_sick_report(make_client, org):
    anna = make_client("anna@example.com")
    a = anna.post("/api/v1/absences", json={"type": "sick", "start_date": "2026-11-05"}).get_json()
    r = anna.patch(f"/api/v1/absences/{a['id']}", json={"end_date": "2026-11-06"})
    assert r.status_code == 200 and r.get_json()["days"] == 2
    assert anna.patch(f"/api/v1/absences/{a['id']}", json={"start_date": "2026-11-04"}).status_code == 403


def test_sick_days_credit_target(make_client, org):
    anna = make_client("anna@example.com")
    anna.post("/api/v1/absences", json={"type": "sick", "start_date": "2026-11-04"})
    day = next(d for d in anna.get("/api/v1/days?from=2026-11-04&to=2026-11-04").get_json()["days"])
    assert day["target_min"] == 0 and day["delta_min"] == 0


# --------------------------------------------------------------------------- attachments

def test_sick_note_upload_optional(make_client, org):
    anna = make_client("anna@example.com")
    lead = make_client("lea@example.com")
    ben = make_client("ben@example.com")
    a = anna.post("/api/v1/absences/sick-today", json={}).get_json()
    assert a["attachments"] == []  # optional
    assert a["permissions"]["attach"]
    r = anna.post(f"/api/v1/absences/{a['id']}/attachments",
                  data={"file": (io.BytesIO(PDF), "arztzeugnis.pdf")}, content_type="multipart/form-data")
    assert r.status_code == 201, r.get_json()
    att = r.get_json()
    assert att["content_type"] == "application/pdf" and att["filename"] == "arztzeugnis.pdf"
    # owner and lead can download, colleague cannot
    d = anna.get(att["url"])
    assert d.status_code == 200 and d.data == PDF
    assert "attachment" in d.headers["Content-Disposition"]
    assert lead.get(att["url"]).status_code == 200
    assert ben.get(att["url"]).status_code == 404
    # lead can add a scan too
    r = lead.post(f"/api/v1/absences/{a['id']}/attachments",
                  data={"file": (io.BytesIO(PNG), "scan.png")}, content_type="multipart/form-data")
    assert r.status_code == 201
    full = anna.get(f"/api/v1/absences/{a['id']}").get_json()
    assert len(full["attachments"]) == 2
    # delete (soft, logged)
    assert anna.delete(att["url"]).status_code == 200
    assert len(anna.get(f"/api/v1/absences/{a['id']}").get_json()["attachments"]) == 1
    assert db.session.scalar(db.select(Revision).where(Revision.entity == "attachment",
                                                       Revision.action == "delete")) is not None


def test_upload_rejects_wrong_types(make_client, org):
    anna = make_client("anna@example.com")
    a = anna.post("/api/v1/absences/sick-today", json={}).get_json()
    r = anna.post(f"/api/v1/absences/{a['id']}/attachments",
                  data={"file": (io.BytesIO(b"MZ\x90\x00evil"), "note.pdf")}, content_type="multipart/form-data")
    assert r.status_code == 422 and r.get_json()["error"]["fields"]["file"] == "type"
    r = anna.post(f"/api/v1/absences/{a['id']}/attachments",
                  data={"file": (io.BytesIO(b""), "empty.pdf")}, content_type="multipart/form-data")
    assert r.status_code == 422
    v = vac(anna, "2026-12-14").get_json()
    r = anna.post(f"/api/v1/absences/{v['id']}/attachments",
                  data={"file": (io.BytesIO(PDF), "x.pdf")}, content_type="multipart/form-data")
    assert r.status_code == 422 and r.get_json()["error"]["fields"]["file"] == "not_allowed"


def test_upload_path_traversal_filename_is_sanitized(make_client, org):
    anna = make_client("anna@example.com")
    a = anna.post("/api/v1/absences/sick-today", json={}).get_json()
    r = anna.post(f"/api/v1/absences/{a['id']}/attachments",
                  data={"file": (io.BytesIO(PDF), "../../etc/passwd.pdf")}, content_type="multipart/form-data")
    assert r.status_code == 201
    assert "/" not in r.get_json()["filename"] and ".." not in r.get_json()["filename"]


# --------------------------------------------------------------------------- team calendar privacy

def test_team_calendar_hides_sick_details_from_colleagues(make_client, org):
    anna = make_client("anna@example.com")
    ben = make_client("ben@example.com")
    lead = make_client("lea@example.com")
    anna.post("/api/v1/absences/sick-today", json={"note": "Migraine"})
    cal = ben.get("/api/v1/calendar/team?from=2026-11-05&to=2026-11-05").get_json()
    row = next(r for r in cal["rows"] if r["user"]["id"] == org["anna"].id)
    ab = row["days"][0]["absences"][0]
    assert ab["label"] == "Absent" and ab["type"] == "absent" and ab["id"] is None
    assert "Migraine" not in str(cal)
    # other team is not visible to Ben at all
    assert org["carl"].id not in [r["user"]["id"] for r in cal["rows"]]
    lead_cal = lead.get("/api/v1/calendar/team?from=2026-11-05&to=2026-11-05").get_json()
    lead_row = next(r for r in lead_cal["rows"] if r["user"]["id"] == org["anna"].id)
    assert lead_row["days"][0]["absences"][0]["type"] == "sick"


def test_vacation_account_carry_over(app, make_client, org):
    u = make_user("old@example.com", start=date(2025, 7, 1), vacation_days_per_year=25)
    c = make_client("old@example.com")
    acc = c.get(f"/api/v1/accounts/{u.id}/vacation?year=2026").get_json()
    # 2025: 25 * 184/365 = 12.6 -> 12.5 days, none taken -> carried over
    assert acc["carried_over"] == 12.5
    assert acc["entitlement"] == 25
    assert acc["remaining"] == 37.5
    admin = make_client("admin@example.com")
    r = admin.put(f"/api/v1/accounts/{u.id}/entitlements/2026", json={"days": 27, "note": "Seniority"})
    assert r.status_code == 200 and r.get_json()["entitlement"] == 27


def test_vacation_prorated_by_scheduled_workdays_setting(app, make_client, org):
    """Off (default): entered days are the person's own days. On: full-time value × scheduled days/5."""
    from resorixtrack.services import settings as st

    admin = make_client("admin@example.com")
    uid = org["anna"].id
    assert admin.get(f"/api/v1/accounts/{uid}/vacation?year=2026").get_json()["entitlement"] == 25
    # Mon-Wed schedule from the start of the year
    sched = org["anna"].schedules[0]
    r = admin.patch(f"/api/v1/schedules/{sched.id}", json={"minutes": {"mon": 504, "tue": 504, "wed": 504, "thu": 0, "fri": 0, "sat": 0, "sun": 0},
                                                           "pensum_percent": 60, "reason": "part-time"})
    assert r.status_code == 200, r.get_json()
    assert admin.get(f"/api/v1/accounts/{uid}/vacation?year=2026").get_json()["entitlement"] == 25  # own days
    st.update({"vacation_prorate_workdays": True})
    db.session.commit()
    assert admin.get(f"/api/v1/accounts/{uid}/vacation?year=2026").get_json()["entitlement"] == 15  # 25 × 3/5
    # a per-year override always wins
    assert admin.put(f"/api/v1/accounts/{uid}/entitlements/2026", json={"days": 20, "note": "x"}).status_code == 200
    assert admin.get(f"/api/v1/accounts/{uid}/vacation?year=2026").get_json()["entitlement"] == 20
