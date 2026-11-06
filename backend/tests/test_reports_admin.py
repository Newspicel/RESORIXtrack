# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
from __future__ import annotations

import io
import sqlite3
import zipfile
from datetime import date

import pytest
from openpyxl import load_workbook

from resorixtrack.extensions import db
from resorixtrack.models import Holiday, HolidayCalendar
from resorixtrack.services import backup_crypto, presets


def _work_week(c):
    for d in ("2026-11-02", "2026-11-03", "2026-11-04"):
        c.post("/api/v1/entries", json={"start_at": f"{d}T08:00:00", "end_at": f"{d}T12:00:00", "reason": "paper"})
        c.post("/api/v1/entries", json={"start_at": f"{d}T12:45:00", "end_at": f"{d}T17:09:00", "reason": "paper"})


# --------------------------------------------------------------------------- reports

def test_timesheet_json_pdf_xlsx_csv(make_client, org):
    anna = make_client("anna@example.com")
    _work_week(anna)
    j = anna.get("/api/v1/reports/timesheet?year=2026&month=11").get_json()
    assert j["summary"]["worked_min"] == 3 * 504
    assert len(j["days"]) == 30
    assert j["entries"]["2026-11-02"][0]["start"] == "08:00"  # local time
    pdf = anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=pdf")
    assert pdf.status_code == 200 and pdf.mimetype == "application/pdf" and pdf.data.startswith(b"%PDF")
    assert "attachment" in pdf.headers["Content-Disposition"]
    x = anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=xlsx")
    wb = load_workbook(io.BytesIO(x.data))
    ws = wb.active
    assert ws["A1"].value == "Date" and ws["A2"].value == "2026-11-01"
    csv = anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=csv")
    assert csv.data.decode("utf-8-sig").splitlines()[0].startswith("Date;Weekday;Public holiday")


def test_timesheet_pdf_in_german(make_client, org):
    org["anna"].locale = "de"
    db.session.commit()
    anna = make_client("anna@example.com")
    pdf = anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=pdf")
    assert pdf.status_code == 200 and pdf.data.startswith(b"%PDF")


def test_timesheet_pdf_in_french(make_client, org):
    org["anna"].locale = "fr"
    db.session.commit()
    anna = make_client("anna@example.com")
    pdf = anna.get("/api/v1/reports/timesheet?year=2026&month=11&format=pdf")
    assert pdf.status_code == 200 and pdf.data.startswith(b"%PDF")


def test_balances_and_absences_reports(make_client, org):
    admin = make_client("admin@example.com")
    anna = make_client("anna@example.com")
    anna.post("/api/v1/absences/sick-today", json={})
    b = admin.get("/api/v1/reports/balances?year=2026&month=11").get_json()
    assert {r["name"] for r in b["rows"]} >= {"Anna A", "Ben B", "Carl C"}
    team = admin.get(f"/api/v1/reports/balances?year=2026&team_id={org['team_a'].id}").get_json()
    assert {r["name"] for r in team["rows"]} == {"Anna A", "Ben B", "Lea Lead"}
    for fmt in ("pdf", "xlsx", "csv"):
        assert admin.get(f"/api/v1/reports/balances?year=2026&format={fmt}").status_code == 200
    a = admin.get("/api/v1/reports/absences?from=2026-11-01&to=2026-11-30").get_json()
    assert a["rows"][0]["type"] == "Sick" and a["summary"]
    for fmt in ("pdf", "xlsx", "csv"):
        assert admin.get(f"/api/v1/reports/absences?from=2026-11-01&to=2026-11-30&format={fmt}").status_code == 200


def test_raw_export_includes_edit_flags(make_client, org):
    anna = make_client("anna@example.com")
    admin = make_client("admin@example.com")
    _work_week(anna)
    rows = admin.get("/api/v1/reports/entries?from=2026-11-01&to=2026-11-30").get_json()
    assert len(rows) == 6 and all(r["source"] == "manual" for r in rows)
    assert admin.get("/api/v1/reports/entries?from=2026-11-01&to=2026-11-30&format=xlsx").status_code == 200
    assert admin.get("/api/v1/reports/entries?from=2026-11-01&to=2026-11-30&format=pdf").status_code == 422


# --------------------------------------------------------------------------- admin

def test_settings(make_client, org):
    admin = make_client("admin@example.com")
    s = admin.get("/api/v1/admin/settings").get_json()
    assert s["holiday_mode"] == "scheduled" and s["session_remember_days"] == 30
    r = admin.patch("/api/v1/admin/settings", json={"holiday_mode": "prorata", "session_remember_days": 14})
    assert r.status_code == 200 and r.get_json()["holiday_mode"] == "prorata"
    assert admin.patch("/api/v1/admin/settings", json={"holiday_mode": "magic"}).status_code == 422
    assert make_client("lea@example.com").get("/api/v1/admin/settings").status_code == 403


def test_smtp_test_mail(make_client, org, outbox):
    admin = make_client("admin@example.com")
    r = admin.post("/api/v1/admin/smtp/test", json={"to": "it@example.com"})
    assert r.status_code == 200
    assert outbox[-1].to == "it@example.com" and outbox[-1].meta["template"] == "test"


def test_backup_create_list_download_delete(app, make_client, org):
    admin = make_client("admin@example.com")
    anna = make_client("anna@example.com")
    sick = anna.post("/api/v1/absences/sick-today", json={}).get_json()
    anna.post(f"/api/v1/absences/{sick['id']}/attachments", data={"file": (io.BytesIO(b"%PDF-1.4 x"), "z.pdf")},
              content_type="multipart/form-data")
    r = admin.post("/api/v1/admin/backups", json={"include_attachments": True})
    assert r.status_code == 201
    name = r.get_json()["name"]
    assert [b["name"] for b in admin.get("/api/v1/admin/backups").get_json()] == [name]
    d = admin.get(f"/api/v1/admin/backups/{name}")
    assert d.status_code == 200 and d.mimetype == "application/octet-stream" and name.endswith(".zip.enc")
    # what leaves the server is an encrypted blob: no ZIP header, no SQLite header, no content
    assert d.data[:5] == backup_crypto.MAGIC and b"SQLite format 3" not in d.data and b"PK\x03\x04" not in d.data
    enc = app.config["DATA_DIR"] / "downloaded.enc"
    enc.write_bytes(d.data)
    plain = app.config["DATA_DIR"] / "downloaded.zip"
    with pytest.raises(backup_crypto.BackupCryptoError):
        backup_crypto.decrypt_file(enc, plain, "not-the-backup-password")
    backup_crypto.decrypt_file(enc, plain, app.config["BACKUP_PASSWORD"])
    zf = zipfile.ZipFile(plain)
    assert {"resorixtrack.db", "manifest.json"} <= set(zf.namelist())
    assert any(n.startswith("attachments/") for n in zf.namelist())
    # the archived DB is a valid, complete SQLite database
    path = app.config["DATA_DIR"] / "check.db"
    path.write_bytes(zf.read("resorixtrack.db"))
    con = sqlite3.connect(path)
    assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert con.execute("SELECT count(*) FROM users").fetchone()[0] == 5
    con.close()
    # traversal attempts
    assert admin.get("/api/v1/admin/backups/..%2F..%2Fresorixtrack.db").status_code == 404
    assert admin.get("/api/v1/admin/backups/resorixtrack.db").status_code == 404
    # download fresh
    assert admin.get("/api/v1/admin/backups/download").status_code == 404  # creating a file is a POST now
    fresh = admin.post("/api/v1/admin/backups/download")
    assert fresh.status_code == 200 and fresh.data[:5] == backup_crypto.MAGIC
    # nothing unencrypted is left on disk
    on_disk = list((app.config["DATA_DIR"] / "backups").iterdir())
    assert on_disk and all(p.name.endswith(".zip.enc") and backup_crypto.is_encrypted(p) for p in on_disk)
    assert admin.delete(f"/api/v1/admin/backups/{name}").status_code == 200
    assert anna.get("/api/v1/admin/backups").status_code == 403
    assert anna.post("/api/v1/admin/backups", json={}).status_code == 403


def test_backup_restore_roundtrip(app, make_client, org, tmp_path):
    from resorixtrack.services import backup

    admin = make_client("admin@example.com")
    name = admin.post("/api/v1/admin/backups", json={}).get_json()["name"]
    target = tmp_path / "restore"
    with pytest.raises(backup_crypto.BackupCryptoError):
        backup.restore(backup.backup_path(name), target, password="wrong-password-123")
    result = backup.restore(backup.backup_path(name), target)  # password from the configuration
    assert result["manifest"]["app"] == "resorixtrack"
    con = sqlite3.connect(target / "resorixtrack.db")
    assert con.execute("SELECT count(*) FROM users").fetchone()[0] == 5
    con.close()


def test_audit_log(make_client, org):
    anna = make_client("anna@example.com")
    admin = make_client("admin@example.com")
    anna.post("/api/v1/entries", json={"start_at": "2026-11-05T08:00:00", "end_at": "2026-11-05T09:00:00"})
    a = admin.get(f"/api/v1/admin/audit?user_id={org['anna'].id}&entity=time_entry").get_json()
    assert a["total"] == 1 and a["items"][0]["action"] == "create"
    h = anna.get(f"/api/v1/users/{org['anna'].id}/history").get_json()
    assert any(x["entity"] == "time_entry" for x in h)


def test_user_and_team_admin(make_client, org, outbox):
    admin = make_client("admin@example.com")
    r = admin.post("/api/v1/users", json={"email": "dup@example.com", "name": "Dup", "pensum_percent": 60,
                                          "employment_start": "2026-03-01"})
    u = r.get_json()
    assert r.status_code == 201
    assert u["schedules"][0]["weekly_minutes"] == round(2520 / 5 * 0.6) * 5
    assert admin.post("/api/v1/users", json={"email": "DUP@example.com", "name": "x"}).status_code == 409
    t = admin.post("/api/v1/teams", json={"name": "Team C", "leads": [{"user_id": u["id"]}], "member_ids": [org["carl"].id]})
    assert t.status_code == 201
    assert t.get_json()["member_ids"] == [org["carl"].id]
    me = make_client()
    # invite user must set password first
    assert me.post("/api/v1/auth/login", json={"email": "dup@example.com", "password": "anything-123"}).status_code == 401
    # schedule version change
    r = admin.post(f"/api/v1/users/{u['id']}/schedules", json={"valid_from": "2026-09-01", "pensum_percent": 80,
                                                                "minutes": {"mon": 403, "tue": 403, "wed": 403, "thu": 403, "fri": 403}})
    assert r.status_code == 201
    scheds = admin.get(f"/api/v1/users/{u['id']}/schedules").get_json()
    assert [s["valid_from"] for s in scheds] == ["2026-03-01", "2026-09-01"]
    assert admin.delete(f"/api/v1/schedules/{scheds[1]['id']}").status_code == 200
    assert admin.delete(f"/api/v1/schedules/{scheds[0]['id']}").status_code == 409  # last one


def test_lead_schedule_permission_setting(make_client, org):
    lead = make_client("lea@example.com")
    admin = make_client("admin@example.com")
    body = {"valid_from": "2026-12-01", "minutes": {"mon": 480}}
    assert lead.post(f"/api/v1/users/{org['anna'].id}/schedules", json=body).status_code == 201
    admin.patch("/api/v1/admin/settings", json={"lead_can_edit_schedules": False})
    body["valid_from"] = "2027-01-01"
    assert lead.post(f"/api/v1/users/{org['anna'].id}/schedules", json=body).status_code == 403


# --------------------------------------------------------------------------- holidays

def test_fribourg_preset_initial_data(app):
    cal = db.session.scalar(db.select(HolidayCalendar).where(HolidayCalendar.name == "CH-FR City of Fribourg"))
    assert cal is not None and cal.is_default
    dates = {h.date: h.name for h in cal.holidays}
    assert len(dates) == 36
    expected = {
        date(2026, 4, 3): "Good Friday", date(2027, 3, 26): "Good Friday", date(2028, 4, 14): "Good Friday",
        date(2029, 3, 30): "Good Friday", date(2026, 5, 14): "Ascension Day", date(2028, 6, 15): "Corpus Christi",
        date(2027, 8, 1): "Swiss National Day", date(2029, 12, 8): "Immaculate Conception",
        date(2028, 12, 25): "Christmas Day", date(2026, 11, 1): "All Saints' Day",
    }
    for d, n in expected.items():
        assert dates[d] == n
    # not statutory in the City of Fribourg list
    assert date(2026, 1, 2) not in dates and date(2026, 12, 26) not in dates and date(2026, 4, 6) not in dates
    presets.install_preset("ch-fr-fribourg")  # idempotent
    assert db.session.scalar(db.select(db.func.count(Holiday.id)).where(Holiday.calendar_id == cal.id)) == 36


def test_holiday_crud_and_import(make_client, org):
    admin = make_client("admin@example.com")
    c = admin.post("/api/v1/holiday-calendars", json={"name": "CH-ZH"}).get_json()
    r = admin.post(f"/api/v1/holiday-calendars/{c['id']}/import", json={"country": "CH", "subdiv": "ZH", "year": 2027,
                                                                       "include_half_days": True})
    assert r.status_code == 200 and r.get_json()["added"] >= 9
    full = admin.get(f"/api/v1/holiday-calendars/{c['id']}?year=2027").get_json()
    eve = next(h for h in full["holidays"] if h["date"] == "2027-12-24")
    assert eve["fraction"] == 0.5
    h = admin.post(f"/api/v1/holiday-calendars/{c['id']}/holidays",
                   json={"date": "2027-06-30", "name": "Company day", "fraction": 1})
    assert h.status_code == 201
    assert admin.post(f"/api/v1/holiday-calendars/{c['id']}/holidays",
                      json={"date": "2027-06-30", "name": "dup"}).status_code == 409
    assert admin.post("/api/v1/holiday-calendars/999/import", json={"country": "XX", "year": 2027}).status_code in (404, 422)
    assert make_client("anna@example.com").post("/api/v1/holiday-calendars", json={"name": "x"}).status_code == 403


def test_calendar_resolution_user_team_default(make_client, org):
    admin = make_client("admin@example.com")
    anna = make_client("anna@example.com")
    zh = admin.post("/api/v1/holiday-calendars", json={"name": "Team cal"}).get_json()
    admin.post(f"/api/v1/holiday-calendars/{zh['id']}/holidays", json={"date": "2026-11-04", "name": "Team day"})
    personal = admin.post("/api/v1/holiday-calendars", json={"name": "Personal"}).get_json()
    admin.post(f"/api/v1/holiday-calendars/{personal['id']}/holidays", json={"date": "2026-11-03", "name": "Mine"})

    def hol(day):
        d = anna.get(f"/api/v1/days?from={day}&to={day}").get_json()["days"][0]
        return d["holiday"]["name"] if d["holiday"] else None

    assert hol("2026-11-01") == "All Saints' Day"  # company default (Fribourg)
    admin.patch(f"/api/v1/teams/{org['team_a'].id}", json={"holiday_calendar_id": zh["id"]})
    assert hol("2026-11-04") == "Team day" and hol("2026-11-01") is None
    admin.patch(f"/api/v1/users/{org['anna'].id}", json={"holiday_calendar_id": personal["id"]})
    assert hol("2026-11-03") == "Mine" and hol("2026-11-04") is None


def test_install_preset_endpoint(make_client, org):
    admin = make_client("admin@example.com")
    r = admin.post("/api/v1/holiday-calendars/presets/ch-fr-fribourg")
    assert r.status_code == 201 and r.get_json()["holiday_count"] == 36
    assert admin.post("/api/v1/holiday-calendars/presets/nope").status_code == 404
    assert make_client("anna@example.com").post("/api/v1/holiday-calendars/presets/ch-fr-fribourg").status_code == 403
