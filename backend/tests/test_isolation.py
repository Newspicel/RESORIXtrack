# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Data isolation: an employee must never see or change another employee's data.

The test walks *every* API route of the application (so new endpoints are covered automatically),
substitutes identifiers that belong to other people and asserts that
  * no response contains other people's private data (emails, notes, file names), and
  * no other person's data in the database changed.
The same is done for a team lead against a member of a team they do not lead, and for API tokens.
"""

from __future__ import annotations

import io
import json
import re

import pytest
from conftest import PASSWORD, make_user

from resorixtrack.extensions import db
from resorixtrack.models import (
    Absence,
    ApiToken,
    Attachment,
    BalanceAdjustment,
    Holiday,
    HolidayCalendar,
    MonthSignoff,
    Project,
    Team,
    TimeEntry,
    User,
    UserSession,
    VacationEntitlement,
    WorkLog,
    WorkSchedule,
)

PDF = b"%PDF-1.4\n%%EOF"
SKIP_PATHS = {"/api/v1/auth/logout", "/api/v1/auth/sessions/revoke-others", "/api/v1/auth/change-password",
              "/api/v1/setup", "/api/v1/auth/login"}


def seed_private_data(make_client, victim_email: str, marker: str) -> dict:
    """Give a user entries, absences (incl. sick note), tokens, adjustments - all tagged with ``marker``."""
    c = make_client(victim_email)
    e = c.post("/api/v1/entries", json={"start_at": "2026-11-04T08:00:00", "end_at": "2026-11-04T12:00:00",
                                        "note": f"{marker}-entry", "reason": f"{marker}-reason"}).get_json()
    sick = c.post("/api/v1/absences/sick-today", json={"note": f"{marker}-sick-note"}).get_json()
    att = c.post(f"/api/v1/absences/{sick['id']}/attachments",
                 data={"file": (io.BytesIO(PDF), f"{marker}-zeugnis.pdf")}, content_type="multipart/form-data").get_json()
    vac = c.post("/api/v1/absences", json={"type": "vacation", "start_date": "2026-12-14",
                                           "note": f"{marker}-vacation-note"}).get_json()
    tok = c.post("/api/v1/tokens", json={"name": f"{marker}-token", "scopes": ["clock"], "current_password": PASSWORD}).get_json()
    log = c.post("/api/v1/worklog", json={"date": "2026-11-04", "minutes": 120, "note": f"{marker}-worklog"}).get_json()
    user = db.session.scalar(db.select(User).where(User.email == victim_email))
    sched = db.session.scalar(db.select(WorkSchedule).where(WorkSchedule.user_id == user.id))
    adj = BalanceAdjustment(user_id=user.id, account="time", amount=60, effective_date=user.employment_start,
                            kind="correction", reason=f"{marker}-adjustment")
    db.session.add(adj)
    db.session.commit()
    sess = db.session.scalar(db.select(UserSession).where(UserSession.user_id == user.id))
    from resorixtrack.services import signoffs

    admin = db.session.scalar(db.select(User).where(User.role == "admin"))
    so = signoffs.sign_off(admin, user, "2026-10", note=f"{marker}-signoff")
    db.session.commit()
    return {"signoff": so.id, "worklog": log["id"], "user": user, "entry": e["id"], "absence": sick["id"], "vacation": vac["id"], "attachment": att["id"],
            "token": tok["id"], "schedule": sched.id, "adjustment": adj.id, "session": sess.id,
            "markers": [marker, user.email]}  # noqa


def snapshot(exclude_user_id: int) -> str:
    """Everything that does not belong to ``exclude_user_id`` (the attacker)."""
    def rows(model, owner_col="user_id"):
        q = db.select(model)
        if owner_col and hasattr(model, owner_col):
            q = q.where(getattr(model, owner_col) != exclude_user_id)
        out = []
        for r in db.session.scalars(q.order_by(model.id)):
            d = {c.name: getattr(r, c.name) for c in model.__table__.columns}
            d.pop("last_seen_at", None)
            d.pop("last_used_at", None)
            out.append(d)
        return out

    db.session.expire_all()
    data = {m.__name__: rows(m) for m in (TimeEntry, Absence, BalanceAdjustment, WorkSchedule, VacationEntitlement,
                                          ApiToken, UserSession, Team, HolidayCalendar, Holiday, MonthSignoff, WorkLog)}
    data["Project"] = rows(Project, owner_col=None)
    data["User"] = [r for r in rows(User, owner_col=None) if r["id"] != exclude_user_id]
    data["Attachment"] = rows(Attachment, owner_col=None)
    return json.dumps(data, default=str, sort_keys=True)


def build_url(rule, ids: dict) -> str:
    def sub(m):
        name = m.group(2)
        if name == "action":
            return "start"
        if name == "year":
            return "2026"
        if name == "month":
            return "2026-10"
        if name == "name":
            return "resorixtrack-20260101-000000.zip"
        if name == "path":
            return "index.html"
        if name == "key":
            return "ch-fr-fribourg"
        if name == "variant":
            return "dark"
        if name == "token_id":
            return str(ids.get("token_id", 1))
        if name == "project_id":
            return "1"
        if name == "row_id":
            return "1"
        return str(ids[name])

    return re.sub(r"<(?:(\w+):)?(\w+)>", sub, rule.rule)


def crawl(app, client, victim: dict, team_id_foreign: int):
    ids = {"user_id": victim["user"].id, "entry_id": victim["entry"], "absence_id": victim["absence"],
           "attachment_id": victim["attachment"], "token_id": victim["token"], "session_id": victim["session"],
           "schedule_id": victim["schedule"], "signoff_id": victim["signoff"], "adj_id": victim["adjustment"], "team_id": team_id_foreign,
           "log_id": victim["worklog"],
           "cal_id": db.session.scalar(db.select(HolidayCalendar.id)), "type_id": 1,
           "holiday_id": db.session.scalar(db.select(Holiday.id))}
    query = (f"?from=2026-10-01&to=2026-12-31&year=2026&month=11&user_id={victim['user'].id}"
             f"&start_date=2026-12-14&format=json&token=x")
    checked = 0
    leaks = []
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/api/v1") or rule.rule in SKIP_PATHS:
            continue
        url = build_url(rule, ids)
        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            body = {"user_id": victim["user"].id, "reason": "probe", "note": "probe", "message": "probe",
                    "type": "vacation", "start_date": "2026-12-15", "start_at": "2026-11-04T13:00:00",
                    "end_at": "2026-11-04T14:00:00", "account": "time", "amount": 999, "days": 99,
                    "name": "probe", "valid_from": "2026-11-01", "minutes": {"mon": 1}}
            r = client.request(method, url + query, json=body)
            checked += 1
            text = r.get_data(as_text=True)
            for marker in victim["markers"]:
                if marker in text:
                    leaks.append(f"{method} {url} -> {r.status_code} leaks '{marker}'")
    return checked, leaks


@pytest.mark.parametrize("auth", ["session", "token"])
def test_employee_cannot_access_colleague_data(app, make_client, org, auth):
    ben = seed_private_data(make_client, "ben@example.com", "BENSECRET")  # same team as Anna
    carl = seed_private_data(make_client, "carl@example.com", "CARLSECRET")  # other team
    anna = make_client("anna@example.com")
    if auth == "token":
        tok = anna.post("/api/v1/tokens", json={"name": "all", "scopes": [
            "clock", "entries:read", "entries:write", "absences:read", "absences:write", "reports:read"],
            "current_password": PASSWORD}).get_json()
        anna = make_client()
        anna.bearer = tok["token"]
    before = snapshot(org["anna"].id)
    total = 0
    for victim, team in ((ben, org["team_a"].id), (carl, org["team_b"].id)):
        checked, leaks = crawl(app, anna, victim, team)
        total += checked
        assert not leaks, "\n".join(leaks)
    assert total > 150  # sanity: we really exercised the API
    assert snapshot(org["anna"].id) == before, "an employee modified someone else's data"


def test_lead_cannot_access_foreign_team(app, make_client, org):
    carl = seed_private_data(make_client, "carl@example.com", "CARLSECRET")
    lead = make_client("lea@example.com")
    before = snapshot(org["lead"].id)
    _, leaks = crawl(app, lead, carl, org["team_b"].id)
    assert not leaks, "\n".join(leaks)
    assert snapshot(org["lead"].id) == before


def test_lead_token_is_limited_to_own_team_and_scopes(app, make_client, org):
    """A team lead's API token reaches the lead's own team (positive control) but nothing of a foreign team,
    and only within the token's scopes."""
    ben = seed_private_data(make_client, "ben@example.com", "BENSECRET")  # team A, led by Lea
    carl = seed_private_data(make_client, "carl@example.com", "CARLSECRET")  # team B
    lead = make_client("lea@example.com")
    tok = lead.post("/api/v1/tokens", json={"name": "desk", "scopes": [
        "clock", "entries:read", "entries:write", "absences:read", "absences:write", "reports:read"],
        "current_password": PASSWORD}).get_json()
    via_token = make_client()
    via_token.bearer = tok["token"]
    r = via_token.get(f"/api/v1/entries?from=2026-11-04&to=2026-11-04&user_id={ben['user'].id}")
    assert r.status_code == 200 and "BENSECRET-entry" in r.get_data(as_text=True)
    before = snapshot(org["lead"].id)
    checked, leaks = crawl(app, via_token, carl, org["team_b"].id)
    assert checked > 100 and not leaks, "\n".join(leaks)  # fewer routes than a session: web-only routes refuse tokens
    assert snapshot(org["lead"].id) == before
    # a narrower token cannot read entries at all, not even of the own team, and never manages projects
    tok2 = lead.post("/api/v1/tokens", json={"name": "clock-only", "scopes": ["clock"], "current_password": PASSWORD}).get_json()
    clock_only = make_client()
    clock_only.bearer = tok2["token"]
    assert clock_only.get(f"/api/v1/entries?from=2026-11-04&to=2026-11-04&user_id={ben['user'].id}").status_code == 403
    assert clock_only.get("/api/v1/projects").status_code == 200  # needed to clock with a project
    assert via_token.post("/api/v1/projects", json={"name": "Via token", "team_id": org["team_a"].id}).status_code == 403


def test_lead_sees_own_team_but_not_their_secrets_outside_scope(app, make_client, org):
    ben = seed_private_data(make_client, "ben@example.com", "BENSECRET")
    lead = make_client("lea@example.com")
    # positive control: the lead *can* see a member's data
    r = lead.get(f"/api/v1/entries?from=2026-11-04&to=2026-11-04&user_id={ben['user'].id}")
    assert r.status_code == 200 and "BENSECRET-entry" in r.get_data(as_text=True)
    assert lead.get(f"/api/v1/attachments/{ben['attachment']}").status_code == 200
    # but not their API tokens or sessions
    assert "BENSECRET-token" not in lead.get("/api/v1/tokens").get_data(as_text=True)
    assert lead.delete(f"/api/v1/tokens/{ben['token']}").status_code == 404
    assert lead.delete(f"/api/v1/auth/sessions/{ben['session']}").status_code == 404


def test_former_lead_loses_access(app, make_client, org):
    ben = seed_private_data(make_client, "ben@example.com", "BENSECRET")
    lead = make_client("lea@example.com")
    assert lead.get(f"/api/v1/users/{ben['user'].id}").status_code == 200
    admin = make_client("admin@example.com")
    admin.patch(f"/api/v1/teams/{org['team_a'].id}", json={"leads": []})
    assert lead.get(f"/api/v1/users/{ben['user'].id}").status_code == 404
    assert lead.get(f"/api/v1/attachments/{ben['attachment']}").status_code == 404


def test_moving_employee_to_other_team_moves_visibility(app, make_client, org):
    ben = seed_private_data(make_client, "ben@example.com", "BENSECRET")
    lead = make_client("lea@example.com")
    admin = make_client("admin@example.com")
    admin.patch(f"/api/v1/users/{ben['user'].id}", json={"team_id": org["team_b"].id})
    assert lead.get(f"/api/v1/entries?from=2026-11-04&to=2026-11-04&user_id={ben['user'].id}").status_code == 404


def test_reports_are_scoped(app, make_client, org):
    seed_private_data(make_client, "ben@example.com", "BENSECRET")
    anna = make_client("anna@example.com")
    bal = anna.get("/api/v1/reports/balances?year=2026").get_json()
    assert [r["user_id"] for r in bal["rows"]] == [org["anna"].id]
    assert anna.get("/api/v1/reports/entries?from=2026-11-01&to=2026-11-30").status_code == 403
    lead = make_client("lea@example.com")
    rows = lead.get("/api/v1/reports/balances?year=2026").get_json()["rows"]
    assert {r["user_id"] for r in rows} == {org["lead"].id, org["anna"].id, org["ben"].id}


def test_new_user_without_team_sees_only_self(app, make_client, org):
    make_user("solo@example.com")
    solo = make_client("solo@example.com")
    assert [u["email"] for u in solo.get("/api/v1/users").get_json()] == ["solo@example.com"]
    cal = solo.get("/api/v1/calendar/team?from=2026-11-01&to=2026-11-30").get_json()
    assert [r["user"]["email"] if "email" in r["user"] else r["user"]["name"] for r in cal["rows"]] == ["Solo"]
