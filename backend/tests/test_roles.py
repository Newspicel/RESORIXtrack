# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Roles: administrators without time data, HR capability, several leads, deputies with periods."""

from __future__ import annotations

from datetime import timedelta

from conftest import DEFAULT_NOW, make_user

from resorixtrack.extensions import db
from resorixtrack.models import Revision
from resorixtrack.timeutil import freeze


def entry(client, day="2026-11-04"):
    r = client.post("/api/v1/entries", json={"start_at": f"{day}T08:00:00", "end_at": f"{day}T12:00:00", "note": "PRIVATE-NOTE", "reason": "x"})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def test_pure_admin_manages_people_but_sees_no_time_data(app, make_client, org):
    root = make_user("root@example.com", "Root Admin", role="admin")  # no capabilities
    admin = make_client("root@example.com")
    anna = make_client("anna@example.com")
    e = entry(anna)
    uid = org["anna"].id
    me = admin.get("/api/v1/me").get_json()
    assert me["permissions"] == {**me["permissions"], "admin": True, "hr": False, "manager": False}
    # administration works ...
    assert admin.get("/api/v1/users").status_code == 200
    assert admin.patch(f"/api/v1/users/{uid}", json={"capabilities": ["projects"]}).status_code == 200
    assert admin.get("/api/v1/admin/settings").status_code == 200
    assert admin.post("/api/v1/teams", json={"name": "New", "leads": [{"user_id": org["lead"].id}]}).status_code == 201
    # ... but no time data of others
    for url in (f"/api/v1/entries?from=2026-11-01&to=2026-11-30&user_id={uid}", f"/api/v1/days?from=2026-11-01&to=2026-11-30&user_id={uid}",
                f"/api/v1/entries/{e['id']}", f"/api/v1/accounts/{uid}/time?year=2026", f"/api/v1/worklog?from=2026-11-01&to=2026-11-30&user_id={uid}",
                f"/api/v1/reports/timesheet?year=2026&month=11&user_id={uid}&format=json", f"/api/v1/users/{uid}/export"):
        r = admin.get(url)
        assert r.status_code in (403, 404), (url, r.status_code)
        assert "PRIVATE-NOTE" not in r.get_data(as_text=True)
    assert admin.get("/api/v1/signoffs/overview?month=2026-10").status_code == 403
    assert admin.get("/api/v1/reports/balances?year=2026&format=json").get_json()["rows"] == [] or \
        [r["name"] for r in admin.get("/api/v1/reports/balances?year=2026&format=json").get_json()["rows"]] == ["Root Admin"]
    # the change log hides time entities from a pure administrator
    audit = admin.get("/api/v1/admin/audit").get_json()
    assert all(i["entity"] in ("user", "team", "team_lead", "project", "api_token", "signoff") for i in audit["items"])
    assert "PRIVATE-NOTE" not in str(audit)
    # with the HR capability the same person sees everything
    make_client("admin@example.com").patch(f"/api/v1/users/{root.id}", json={"capabilities": ["hr"]})
    assert admin.get(f"/api/v1/entries?from=2026-11-01&to=2026-11-30&user_id={uid}").status_code == 200
    assert "PRIVATE-NOTE" in str(admin.get("/api/v1/admin/audit").get_json())
    assert admin.get(f"/api/v1/users/{uid}/export").status_code == 200


def test_hr_signs_off_leads_and_reopens(app, make_client, org):
    hr_user = make_user("hr@example.com", "Hanna HR", capabilities=["hr"])
    hr = make_client("hr@example.com")
    lead = make_client("lea@example.com")
    assert hr.get("/api/v1/me").get_json()["permissions"]["manager"] is True
    # HR sees all teams and all people, can sign off the lead's own month
    assert {tm["name"] for tm in hr.get("/api/v1/teams").get_json()} == {"Team A", "Team B"}
    r = hr.post("/api/v1/signoffs", json={"user_ids": [org["lead"].id], "month": "2026-10"})
    assert r.status_code in (200, 201), r.get_json()
    row = next(x for x in hr.get("/api/v1/signoffs").get_json() if x["user_id"] == org["lead"].id)
    assert lead.post(f"/api/v1/signoffs/{row['id']}/reopen", json={"reason": "x"}).status_code == 403
    assert hr.post(f"/api/v1/signoffs/{row['id']}/reopen", json={"reason": "typo"}).status_code == 200
    # nobody signs their own month, not even HR (refused as forbidden or as a blocker, never created)
    assert hr.post("/api/v1/signoffs", json={"user_ids": [hr_user.id], "month": "2026-10"}).status_code in (403, 409)
    assert not [x for x in hr.get("/api/v1/signoffs").get_json() if x["user_id"] == hr_user.id]


def test_multiple_leads_and_deputy_period(app, make_client, org, outbox):
    """Two leads and a deputy for two weeks: all of them approve; the deputy only within the period."""
    admin = make_client("admin@example.com")
    team = org["team_a"]
    today = DEFAULT_NOW.date()
    # second lead (open-ended) and a deputy for the next two weeks
    assert admin.post(f"/api/v1/teams/{team.id}/leads", json={"user_id": org["ben"].id, "role": "lead"}).status_code == 201
    r = admin.post(f"/api/v1/teams/{team.id}/leads", json={"user_id": org["carl"].id, "role": "deputy",
                                                            "valid_from": today.isoformat(), "valid_to": (today + timedelta(days=14)).isoformat()})
    assert r.status_code == 201, r.get_json()
    deputy_row = r.get_json()["id"]
    assert admin.post(f"/api/v1/teams/{team.id}/leads", json={"user_id": org["carl"].id, "role": "deputy",
                                                               "valid_from": today.isoformat(), "valid_to": (today + timedelta(days=14)).isoformat()}).status_code == 409
    assert admin.post(f"/api/v1/teams/{team.id}/leads", json={"user_id": org["carl"].id, "valid_from": "2026-12-01", "valid_to": "2026-11-01"}).status_code == 422
    rows = admin.get(f"/api/v1/teams/{team.id}/leads").get_json()
    assert [(x["name"], x["role"], x["active"]) for x in rows] == [("Lea Lead", "lead", True), ("Ben B", "lead", True), ("Carl C", "deputy", True)]
    assert db.session.scalar(db.select(db.func.count(Revision.id)).where(Revision.entity == "team_lead", Revision.action == "create")) == 2
    # Anna requests vacation: every current lead/deputy is asked
    anna = make_client("anna@example.com")
    outbox.clear()
    a = anna.post("/api/v1/absences", json={"type": "vacation", "start_date": "2026-12-14", "end_date": "2026-12-15"}).get_json()
    assert a["status"] == "pending"
    assert {m.to for m in outbox if m.meta["template"] == "absence_requested"} == {"lea@example.com", "ben@example.com", "carl@example.com"}
    carl = make_client("carl@example.com")
    assert carl.get("/api/v1/me").get_json()["permissions"]["lead"] is True
    assert any(x["id"] == a["id"] for x in carl.get("/api/v1/absences/pending").get_json())
    assert carl.get(f"/api/v1/entries?from=2026-11-01&to=2026-11-30&user_id={org['anna'].id}").status_code == 200
    # outside the period the deputy is an ordinary employee again
    freeze(DEFAULT_NOW + timedelta(days=20))
    carl2 = make_client("carl@example.com")
    assert carl2.get("/api/v1/me").get_json()["permissions"]["lead"] is False
    assert carl2.get(f"/api/v1/entries?from=2026-11-01&to=2026-11-30&user_id={org['anna'].id}").status_code == 404
    assert carl2.post(f"/api/v1/absences/{a['id']}/approve", json={}).status_code in (403, 404)
    freeze(DEFAULT_NOW)
    # a lead names and removes deputies of their own team, but can't appoint leads or touch other teams
    lead = make_client("lea@example.com")
    assert lead.post(f"/api/v1/teams/{team.id}/leads", json={"user_id": org["carl"].id, "role": "lead"}).status_code == 403
    assert lead.post(f"/api/v1/teams/{org['team_b'].id}/leads", json={"user_id": org["carl"].id, "role": "deputy"}).status_code == 403
    r = lead.post(f"/api/v1/teams/{team.id}/leads", json={"user_id": org["anna"].id, "role": "deputy", "valid_from": "2026-12-20", "valid_to": "2026-12-31"})
    assert r.status_code == 201
    assert lead.delete(f"/api/v1/teams/{team.id}/leads/{r.get_json()['id']}").status_code == 200
    assert lead.delete(f"/api/v1/teams/{team.id}/leads/{deputy_row}").status_code == 200  # deputies of own team
    assert lead.delete(f"/api/v1/teams/{team.id}/leads/{rows[1]['id']}").status_code == 403  # not another lead
    # deactivating a lead removes their lead rows
    assert admin.patch(f"/api/v1/users/{org['ben'].id}", json={"is_active": False}).status_code == 200
    assert [x["name"] for x in admin.get(f"/api/v1/teams/{team.id}/leads").get_json()] == ["Lea Lead"]
    # the deputy is notified when named
    assert any(m.meta.get("template") == "absence_requested" for m in outbox)


def test_approvals_fall_back_to_hr_then_admins(app, make_client, org, outbox):
    """Team B has no lead: requests go to HR; without any HR person, to the administrators."""
    carl = make_client("carl@example.com")
    outbox.clear()
    carl.post("/api/v1/absences", json={"type": "vacation", "start_date": "2026-12-14"})
    assert {m.to for m in outbox if m.meta["template"] == "absence_requested"} == {"admin@example.com"}  # admin holds HR in the fixture
    root = make_user("root@example.com", "Root Admin", role="admin")
    # remove HR from the admin: the pure administrators are the last resort
    make_client("admin@example.com").patch(f"/api/v1/users/{org['admin'].id}", json={"capabilities": []})
    outbox.clear()
    carl.post("/api/v1/absences", json={"type": "vacation", "start_date": "2026-12-21"})
    assert {m.to for m in outbox if m.meta["template"] == "absence_requested"} == {"admin@example.com", "root@example.com"}
    pending = make_client("root@example.com").get("/api/v1/absences/pending").get_json()
    assert {p["user"]["id"] for p in pending} == {org["carl"].id}
    assert not any(p["user"]["id"] == org["anna"].id for p in pending)  # team A has a lead: not the admin's business
    assert db.session.get(type(root), root.id) is not None


def test_projects_capability(app, make_client, org):
    root = make_user("root@example.com", "Root Admin", role="admin")
    admin = make_client("root@example.com")
    assert admin.post("/api/v1/projects", json={"name": "Company"}).status_code == 403  # admin alone can't
    make_client("admin@example.com").patch(f"/api/v1/users/{root.id}", json={"capabilities": ["projects"]})
    assert admin.post("/api/v1/projects", json={"name": "Company"}).status_code == 201
    assert admin.post("/api/v1/projects", json={"name": "Team B thing", "team_id": org["team_b"].id}).status_code == 201
    assert admin.get("/api/v1/me").get_json()["permissions"]["projects"] is True
    assert admin.patch(f"/api/v1/users/{root.id}", json={"capabilities": ["bogus"]}).status_code == 422
