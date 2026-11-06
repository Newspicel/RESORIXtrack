# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Data export (access requests) and anonymisation of former employees."""

from __future__ import annotations

import io
import json

from conftest import PASSWORD

from resorixtrack.extensions import db
from resorixtrack.models import Attachment, LoginAttempt, Revision, User
from resorixtrack.services import privacy

PDF = b"%PDF-1.4 test"


def test_export_contains_everything_and_is_admin_or_self_only(make_client, org):
    anna = make_client("anna@example.com")
    anna.post("/api/v1/entries", json={"start_at": "2026-11-04T08:00:00", "end_at": "2026-11-04T12:00:00", "note": "SECRET-NOTE", "reason": "late"})
    sick = anna.post("/api/v1/absences/sick-today", json={"note": "sick note text"}).get_json()
    anna.post(f"/api/v1/absences/{sick['id']}/attachments", data={"file": (io.BytesIO(PDF), "zeugnis.pdf")},
              content_type="multipart/form-data")
    # self export
    r = anna.get("/api/v1/me/export")
    assert r.status_code == 200 and r.mimetype == "application/json"
    data = json.loads(r.data)
    assert data["profile"]["email"] == "anna@example.com"
    assert any(e["note"] == "SECRET-NOTE" for e in data["time_entries"])
    assert data["absences"][0]["attachments"][0]["filename"] == "zeugnis.pdf"
    assert data["change_history"] and data["sign_in_attempts"] and data["sessions"]
    # admin export of someone else; employees and leads can't
    admin = make_client("admin@example.com")
    assert admin.get(f"/api/v1/users/{org['anna'].id}/export").status_code == 200
    assert make_client("lea@example.com").get(f"/api/v1/users/{org['anna'].id}/export").status_code == 403
    assert make_client("ben@example.com").get(f"/api/v1/users/{org['anna'].id}/export").status_code == 403


def test_anonymize_former_employee(app, make_client, org, tmp_path):
    anna = make_client("anna@example.com")
    anna.post("/api/v1/entries", json={"start_at": "2026-11-04T08:00:00", "end_at": "2026-11-04T12:00:00", "note": "kept", "reason": "late"})
    sick = anna.post("/api/v1/absences/sick-today", json={"note": "n"}).get_json()
    anna.post(f"/api/v1/absences/{sick['id']}/attachments", data={"file": (io.BytesIO(PDF), "zeugnis.pdf")},
              content_type="multipart/form-data")
    admin = make_client("admin@example.com")
    uid = org["anna"].id
    body = {"admin_password": PASSWORD}
    # must be inactive first
    r = admin.post(f"/api/v1/users/{uid}/anonymize", json={**body, "force": True})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "still_active"
    assert admin.patch(f"/api/v1/users/{uid}", json={"is_active": False}).status_code == 200
    # retention: no end date -> refused unless forced; wrong admin password refused
    assert admin.post(f"/api/v1/users/{uid}/anonymize", json=body).status_code == 422
    assert admin.post(f"/api/v1/users/{uid}/anonymize", json={"admin_password": "wrong", "force": True}).status_code == 422
    att_file = next((tmp_path / "attachments").iterdir())
    assert att_file.exists()
    r = admin.post(f"/api/v1/users/{uid}/anonymize", json={**body, "force": True})
    assert r.status_code == 200, r.get_json()
    u = db.session.get(User, uid)
    assert u.name == f"Former employee #{uid}" and u.email == f"anonymised-{uid}@invalid.local" and u.password_hash is None
    assert not att_file.exists()
    att = db.session.scalar(db.select(Attachment))
    assert att.is_deleted and att.filename == "removed" and att.sha256  # record + checksum kept
    assert db.session.scalar(db.select(db.func.count(LoginAttempt.id)).where(LoginAttempt.user_id == uid)) == 0
    # identity scrubbed from the change history, working-time records kept
    for r_ in db.session.scalars(db.select(Revision).where(Revision.subject_user_id == uid)):
        blob = json.dumps([r_.before, r_.after, r_.reason])
        assert "Anna A" not in blob and "anna@example.com" not in blob
    assert db.session.scalar(db.select(Revision).where(Revision.action == "anonymize")) is not None
    exported = privacy.export_user(u)
    assert exported["time_entries"][0]["note"] == "kept"
    # the append-only guard is back in place
    from resorixtrack import db_guards

    with db.engine.connect() as conn:
        assert "trg_revisions_no_update" in db_guards.installed(conn)
    assert admin.post(f"/api/v1/users/{uid}/anonymize", json={**body, "force": True}).status_code == 409
    # the anonymised address can't sign in
    assert make_client().post("/api/v1/auth/login", json={"email": u.email, "password": PASSWORD}).status_code == 401


def test_anonymize_cli(app, org, make_client):
    from click.testing import CliRunner

    admin = make_client("admin@example.com")
    uid = org["carl"].id
    assert admin.patch(f"/api/v1/users/{uid}", json={"is_active": False, "employment_end": "2020-01-31"}).status_code == 200
    runner = CliRunner()
    r = runner.invoke(app.cli, ["resorixtrack", "anonymize", "--email", "carl@example.com", "--yes"])
    assert r.exit_code == 0, r.output
    assert "Anonymised user" in r.output
    db.session.expire_all()
    assert db.session.get(User, uid).email == f"anonymised-{uid}@invalid.local"
