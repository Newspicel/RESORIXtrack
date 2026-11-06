# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Background jobs (run as a separate `worker` container: `flask resorixtrack worker`)."""

from __future__ import annotations

import signal
import time
from datetime import datetime, timedelta

from flask import Flask

from .extensions import db
from .models import ApiToken, AuthToken, LoginAttempt, Notification, TimeEntry, User, UserSession
from .services import mail, notifications
from .services import settings as settings_svc
from .timeutil import utcnow, zone


def send_clock_reminders() -> int:
    hours = int(settings_svc.get("clock_reminder_hours"))
    if hours <= 0:
        return 0
    cutoff = utcnow() - timedelta(hours=hours)
    sent = 0
    running = db.session.scalars(db.select(TimeEntry).where(
        TimeEntry.end_at.is_(None), TimeEntry.is_deleted.is_(False), TimeEntry.start_at <= cutoff))
    for e in running:
        already = db.session.scalar(db.select(Notification.id).where(
            Notification.user_id == e.user_id, Notification.kind == "clock_reminder",
            Notification.created_at >= e.start_at).limit(1))
        if already:
            continue
        user = db.session.get(User, e.user_id)
        if not user or not user.is_active:
            continue
        notifications.notify(user, "clock_reminder", entry_id=e.id, since=e.start_at.isoformat(), hours=hours)
        mail.send(mail.build("clock_reminder", user.email, user.locale, user=user, hours=hours,
                             since=e.start_at.astimezone(zone(user.timezone))))
        sent += 1
    db.session.commit()
    return sent


def cleanup() -> None:
    now = utcnow()
    keep = int(settings_svc.get("login_log_retention_days"))
    db.session.execute(db.delete(LoginAttempt).where(LoginAttempt.at < now - timedelta(days=keep)))
    db.session.execute(db.delete(UserSession).where(UserSession.expires_at < now - timedelta(days=7)))
    db.session.execute(db.delete(Notification).where(Notification.read_at.is_not(None),
                                                     Notification.created_at < now - timedelta(days=180)))
    db.session.execute(db.delete(AuthToken).where(db.or_(AuthToken.used_at.is_not(None),
                                                         AuthToken.expires_at < now),
                                                  AuthToken.created_at < now - timedelta(days=7)))
    db.session.execute(db.delete(ApiToken).where(db.or_(ApiToken.revoked_at < now - timedelta(days=90),
                                                        ApiToken.expires_at < now - timedelta(days=90))))
    db.session.commit()


def run_forever(app: Flask, interval: int = 60, backup_hour: int = 2) -> None:  # pragma: no cover - loop
    from .services import backup

    stop = {"flag": False}

    def _stop(*_):
        stop["flag"] = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    last_backup_day = None
    last_cleanup: datetime | None = None
    app.logger.info("RESORIXtrack worker started (interval %ss, nightly backup at %02d:00)", interval, backup_hour)
    while not stop["flag"]:
        with app.app_context():
            try:
                n = send_clock_reminders()
                if n:
                    app.logger.info("Sent %d clock reminder(s)", n)
                tz = settings_svc.get("default_timezone")
                local = utcnow().astimezone(zone(tz))
                if local.hour == backup_hour and last_backup_day != local.date():
                    info = backup.create_backup(include_attachments=True, label="auto")
                    backup.rotate()
                    last_backup_day = local.date()
                    app.logger.info("Nightly backup written: %s", info["name"])
                if last_cleanup is None or utcnow() - last_cleanup > timedelta(hours=6):
                    cleanup()
                    last_cleanup = utcnow()
            except Exception:  # noqa: BLE001
                app.logger.exception("Worker job failed")
                db.session.rollback()
            finally:
                db.session.remove()
        for _ in range(interval):
            if stop["flag"]:
                break
            time.sleep(1)
    app.logger.info("RESORIXtrack worker stopped")
