# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Any

import pytest

from resorixtrack import create_app
from resorixtrack.extensions import db
from resorixtrack.models import Team, User
from resorixtrack.services import absences, presets
from resorixtrack.services import settings as settings_svc
from resorixtrack.services import users as users_svc
from resorixtrack.timeutil import freeze

PASSWORD = "Correct-Horse-42!"
# Thursday 5 Nov 2026, 15:00 Zurich (CET, UTC+1)
DEFAULT_NOW = datetime(2026, 11, 5, 14, 0, tzinfo=UTC)


@pytest.fixture
def app(tmp_path):
    app = create_app("testing", overrides={
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'test.db'}",
        "DATA_DIR": tmp_path,
    })
    with app.app_context():
        db.create_all()
        absences.seed_types()
        presets.install_preset("ch-fr-fribourg", make_default=True)
        settings_svc.update({"setup_complete": True})
        db.session.commit()
        freeze(DEFAULT_NOW)
        yield app
        freeze(None)
        db.session.remove()
        db.drop_all()
        db.engine.dispose()


@pytest.fixture
def outbox(app):
    box: list = []
    app.extensions["mail_outbox"] = box
    return box


class ApiClient:
    """Test client that handles the CSRF header like the frontend does."""

    def __init__(self, app, flask_client):
        self.app = app
        self.c = flask_client
        self.bearer: str | None = None

    def _csrf(self) -> str | None:
        cookie = self.c.get_cookie("rt_csrf")
        return cookie.value if cookie else None

    def request(self, method: str, url: str, **kw: Any):
        headers = kw.pop("headers", {}) or {}
        if self.bearer:
            headers["Authorization"] = f"Bearer {self.bearer}"
        elif method not in ("GET", "HEAD") and self._csrf() and not kw.pop("no_csrf", False):
            headers.setdefault("X-CSRF-Token", self._csrf())
        return self.c.open(url, method=method, headers=headers, **kw)

    def get(self, url, **kw):
        return self.request("GET", url, **kw)

    def post(self, url, **kw):
        return self.request("POST", url, **kw)

    def patch(self, url, **kw):
        return self.request("PATCH", url, **kw)

    def put(self, url, **kw):
        return self.request("PUT", url, **kw)

    def delete(self, url, **kw):
        return self.request("DELETE", url, **kw)

    def login(self, email: str, password: str = PASSWORD, remember: bool = True):
        r = self.post("/api/v1/auth/login", json={"email": email, "password": password, "remember": remember})
        assert r.status_code == 200, r.get_json()
        return r


@pytest.fixture
def client(app):
    return ApiClient(app, app.test_client())


@pytest.fixture
def make_client(app):
    def _make(email: str | None = None) -> ApiClient:
        c = ApiClient(app, app.test_client())
        if email:
            c.login(email)
        return c

    return _make


def make_user(email: str, name: str | None = None, *, role: str = "employee", team: Team | None = None,
              pensum: float = 100.0, start: date | None = date(2026, 1, 1), password: str = PASSWORD,
              minutes: dict | None = None, **extra) -> User:
    data = {"email": email, "name": name or email.split("@")[0].title(), "role": role,
            "team_id": team.id if team else None, "pensum_percent": pensum, "employment_start": start,
            "schedule_minutes": minutes, **extra}
    u = users_svc.create_user(None, data, password=password, send_invite=False)
    db.session.commit()
    return u


def make_team(name: str, lead: User | None = None, deputies: list[tuple[User, date | None, date | None]] = ()) -> Team:
    from resorixtrack.models import TeamLead

    t = Team(name=name)
    db.session.add(t)
    db.session.flush()
    if lead:
        db.session.add(TeamLead(team_id=t.id, user_id=lead.id, role="lead"))
    for u, vf, vt in deputies:
        db.session.add(TeamLead(team_id=t.id, user_id=u.id, role="deputy", valid_from=vf, valid_to=vt))
    db.session.commit()
    return t


@pytest.fixture
def org(app):
    """Company with an admin, two teams (one led by Lea), an employee without team."""
    # The test administrator also holds the HR + projects capabilities (like most small companies' admin).
    admin = make_user("admin@example.com", "Ada Admin", role="admin", capabilities=["hr", "projects"])
    lead = make_user("lea@example.com", "Lea Lead")
    team_a = make_team("Team A", lead)
    team_b = make_team("Team B")  # no lead -> approvals fall back to admins
    anna = make_user("anna@example.com", "Anna A", team=team_a)
    ben = make_user("ben@example.com", "Ben B", team=team_a)
    carl = make_user("carl@example.com", "Carl C", team=team_b)
    lead.team_id = team_a.id
    db.session.commit()
    return {"admin": admin, "lead": lead, "team_a": team_a, "team_b": team_b, "anna": anna, "ben": ben,
            "carl": carl}


def extract_link(mail, path: str) -> str:
    m = re.search(rf"(/{path}[?#]token=[A-Za-z0-9_\-]+)", mail.text)
    assert m, mail.text
    return m.group(1)


def token_from(link: str) -> str:
    return link.split("token=")[1]
