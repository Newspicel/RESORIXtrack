# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
from __future__ import annotations

import re

from resorixtrack.services import mail


class FakeSMTP:
    instances: list = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port, self.calls = host, port, []
        FakeSMTP.instances.append(self)

    def ehlo(self):
        self.calls.append("ehlo")

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, user, pw):
        self.calls.append(("login", user))

    def send_message(self, msg):
        self.calls.append(("send", msg))

    def quit(self):
        self.calls.append("quit")


def test_smtp_delivery_starttls_with_logo(app, org, monkeypatch):
    monkeypatch.setattr(mail.smtplib, "SMTP", FakeSMTP)
    app.config.update(TESTING=False, SMTP_HOST="smtp.example.com", SMTP_PORT=587, SMTP_SECURITY="starttls",
                      SMTP_USER="u", SMTP_PASSWORD="p", MAIL_FROM="RESORIXtrack <rt@example.com>")
    try:
        m = mail.build("invite", "x@example.com", "de", user=org["anna"], actor=org["admin"],
                       link="https://rt.example.com/invite?token=abc", hours=72)
        assert m.subject == "Einladung zu RESORIXtrack"
        assert "https://rt.example.com/invite?token=abc" in m.text
        mail.deliver(app, m)
    finally:
        app.config["TESTING"] = True
    smtp = FakeSMTP.instances[-1]
    assert smtp.calls[:3] == ["ehlo", "starttls", "ehlo"]
    assert ("login", "u") in smtp.calls
    msg = next(c[1] for c in smtp.calls if isinstance(c, tuple) and c[0] == "send")
    assert msg["To"] == "x@example.com"
    body = msg.as_string()
    assert "Content-ID: <logo>" in body and "text/plain" in body and "text/html" in body


def test_all_templates_render_in_all_languages(app, org):
    from datetime import datetime

    from resorixtrack.models import Absence, AbsenceType

    t = AbsenceType(key="vacation", label="Vacation", allows_attachments=True)
    a = Absence(start_date=datetime(2026, 12, 14).date(), end_date=datetime(2026, 12, 18).date(), note="n")
    now = datetime(2026, 11, 5, 10, 0)
    ctx = dict(user=org["anna"], actor=org["lead"], requester=org["anna"], link="https://x/y?token=t", hours=72,
               minutes=60, action="update", reason="r", entry=None, local_start=now, local_end=now, message="m",
               absence=a, type=t, days=5, note="ok", since=now)
    names = ["invite", "password_reset", "password_changed", "entry_corrected", "entry_disputed",
             "absence_requested", "absence_reported", "absence_recorded", "absence_approved", "absence_rejected",
             "absence_cancelled", "clock_reminder", "test"]
    for loc in ("en", "de", "fr"):
        for n in names:
            m = mail.build(n, "a@b.c", loc, **ctx)
            assert m.subject and "{{" not in m.text and "{%" not in m.html, (loc, n)
            # privacy: no remote resources in emails - images only as inline (cid:) parts, no tracking,
            # no web fonts, no scripts; links are plain text links the reader has to click
            srcs = re.findall(r'<img[^>]+src="([^"]+)"', m.html)
            assert all(src.startswith("cid:") for src in srcs), (loc, n, srcs)
            assert "<link" not in m.html and "<script" not in m.html and "url(" not in m.html and "@import" not in m.html, (loc, n)
    de = mail.build("absence_approved", "a@b.c", "de", **ctx)
    assert "Ferien" in de.subject
    fr = mail.build("absence_approved", "a@b.c", "fr", **ctx)
    assert "Vacances" in fr.subject and "5 jours de travail" in fr.text
    fr_one = mail.build("absence_approved", "a@b.c", "fr", **{**ctx, "days": 1})
    assert "1 jour de travail" in fr_one.text
