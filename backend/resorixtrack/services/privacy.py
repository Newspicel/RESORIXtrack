# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Data-protection helpers: export everything stored about a person, and anonymise a former employee.

Export (access request): a JSON document with the profile, schedules, entitlements, adjustments, every
time entry (including deleted ones), absences with document metadata, sign-offs, the change history
about the person, sessions, API tokens and sign-in attempts.

Anonymisation (after the retention period): the person's identifying data is replaced by a neutral
placeholder, documents are deleted, logs/sessions/tokens/notifications are removed, and their name and
email are scrubbed from the change history. Working-time records (entries, absences, adjustments)
stay, because they must be kept for the statutory period and signed-off months are immutable.
"""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from typing import Any

from flask import current_app
from sqlalchemy import text

from .. import db_guards
from ..errors import Conflict, Validation
from ..extensions import db
from ..models import (
    Absence,
    ApiToken,
    Attachment,
    AuthToken,
    BalanceAdjustment,
    LoginAttempt,
    MonthSignoff,
    Notification,
    Revision,
    TimeEntry,
    User,
    UserSession,
    VacationEntitlement,
)
from ..timeutil import iso, local_today, utcnow
from . import absences as absences_svc
from . import entries as entries_svc
from . import revisions, signoffs
from . import users as users_svc


def export_user(u: User) -> dict[str, Any]:
    entries = db.session.scalars(db.select(TimeEntry).where(TimeEntry.user_id == u.id).order_by(TimeEntry.start_at))
    absences = db.session.scalars(db.select(Absence).where(Absence.user_id == u.id).order_by(Absence.start_date))
    adjustments = db.session.scalars(db.select(BalanceAdjustment).where(BalanceAdjustment.user_id == u.id)
                                     .order_by(BalanceAdjustment.effective_date))
    entitlements = db.session.scalars(db.select(VacationEntitlement).where(VacationEntitlement.user_id == u.id))
    revs = db.session.scalars(db.select(Revision).where(Revision.subject_user_id == u.id).order_by(Revision.id))
    sessions = db.session.scalars(db.select(UserSession).where(UserSession.user_id == u.id).order_by(UserSession.id))
    tokens = db.session.scalars(db.select(ApiToken).where(ApiToken.user_id == u.id).order_by(ApiToken.id))
    attempts = db.session.scalars(db.select(LoginAttempt).where(LoginAttempt.user_id == u.id).order_by(LoginAttempt.id))
    signoff_rows = db.session.scalars(db.select(MonthSignoff).where(MonthSignoff.user_id == u.id).order_by(MonthSignoff.id))
    notes = db.session.scalars(db.select(Notification).where(Notification.user_id == u.id).order_by(Notification.id))
    return {
        "exported_at": iso(utcnow()), "format": 1,
        "profile": users_svc.serialize_user(u, detail=True),
        "entitlements": [{"year": e.year, "days": e.days, "note": e.note} for e in entitlements],
        "adjustments": [{"id": a.id, "account": a.account, "amount": a.amount, "effective_date": a.effective_date.isoformat(),
                         "kind": a.kind, "reason": a.reason, "created_at": iso(a.created_at), "deleted": a.is_deleted}
                        for a in adjustments],
        "time_entries": [entries_svc.serialize(e) for e in entries],
        "absences": [absences_svc.serialize(a) for a in absences],
        "signoffs": [signoffs.serialize(r) for r in signoff_rows],
        "change_history": [revisions.serialize(r) for r in revs],
        "sessions": [{"id": s.id, "created_at": iso(s.created_at), "last_seen_at": iso(s.last_seen_at), "ip": s.ip,
                      "user_agent": s.user_agent, "revoked_at": iso(s.revoked_at)} for s in sessions],
        "api_tokens": [{"id": t.id, "name": t.name, "prefix": t.prefix, "scopes": t.scopes, "created_at": iso(t.created_at),
                        "last_used_at": iso(t.last_used_at), "revoked_at": iso(t.revoked_at)} for t in tokens],
        "sign_in_attempts": [{"at": iso(a.at), "success": a.success, "reason": a.reason, "ip": a.ip, "user_agent": a.user_agent}
                             for a in attempts],
        "notifications": [{"kind": n.kind, "payload": n.payload, "created_at": iso(n.created_at), "read_at": iso(n.read_at)}
                          for n in notes],
    }


def export_user_json(u: User) -> bytes:
    return json.dumps(export_user(u), ensure_ascii=False, indent=2, default=str).encode("utf-8")


# --------------------------------------------------------------------------- anonymisation

ANON_NAME = "Former employee #{id}"
ANON_EMAIL = "anonymised-{id}@invalid.local"


def anonymize_user(actor: User | None, u: User, *, retention_days: int = 0, force: bool = False) -> dict[str, Any]:
    """Irreversibly remove the identity of a former employee. Requires the account to be inactive and,
    unless ``force``, the employment to have ended at least ``retention_days`` ago."""
    if u.is_active:
        raise Conflict("Deactivate the account first", code="still_active")
    if u.email.startswith("anonymised-") and u.email.endswith("@invalid.local"):
        raise Conflict("This account is already anonymised", code="already_anonymised")
    if not force:
        if u.employment_end is None:
            raise Validation("Set the employment end date first (or use force)", fields={"employment_end": "required"})
        if u.employment_end + timedelta(days=retention_days) > local_today(u.timezone):
            raise Conflict(f"The retention period of {retention_days} days has not passed yet", code="retention")
    old_name, old_email = u.name, u.email
    new_name, new_email = ANON_NAME.format(id=u.id), ANON_EMAIL.format(id=u.id)

    # documents: files and file names go, the records (with checksum) stay for the audit trail
    removed_files = 0
    att_dir = Path(current_app.config["DATA_DIR"]) / "attachments"
    for att in db.session.scalars(db.select(Attachment).join(Absence, Absence.id == Attachment.absence_id)
                                  .where(Absence.user_id == u.id)):
        path = att_dir / att.storage_name
        if path.exists():
            path.unlink()
            removed_files += 1
        att.is_deleted = True
        att.size = 0
        att.filename = "removed"

    # access artefacts and logs
    for model in (UserSession, ApiToken, AuthToken, Notification):
        db.session.execute(db.delete(model).where(model.user_id == u.id))
    db.session.execute(db.delete(LoginAttempt).where(db.or_(LoginAttempt.user_id == u.id, LoginAttempt.email == old_email)))

    # the person themselves
    u.name = new_name
    u.email = new_email
    u.password_hash = None
    u.notify_email_on_correction = False
    db.session.flush()

    # change history: scrub the identity from snapshots and reasons. The log is append-only by trigger;
    # the guard is lifted only inside this transaction and re-installed right after.
    conn = db.session.connection()
    scrubbed = 0
    for name in ("trg_revisions_no_update", "trg_revisions_no_delete"):
        conn.execute(text(f"DROP TRIGGER IF EXISTS {name}"))
    try:
        for r in db.session.scalars(db.select(Revision).where(db.or_(Revision.subject_user_id == u.id,
                                                                     Revision.actor_id == u.id))):
            changed = False
            for col in ("before", "after"):
                val = getattr(r, col)
                if val is None:
                    continue
                dumped = json.dumps(val)
                if old_name in dumped or old_email in dumped:
                    setattr(r, col, json.loads(dumped.replace(old_email, new_email).replace(old_name, new_name)))
                    changed = True
            if r.reason and (old_name in r.reason or old_email in r.reason):
                r.reason = r.reason.replace(old_email, new_email).replace(old_name, new_name)
                changed = True
            scrubbed += int(changed)
        db.session.flush()
    finally:
        for trig_name, sql in db_guards.TRIGGERS:
            if trig_name.startswith("trg_revisions_"):
                conn.execute(text(sql))
    db.session.add(Revision(entity="user", entity_id=u.id, subject_user_id=u.id, actor_id=actor.id if actor else None,
                            action="anonymize", before=None,
                            after={"documents_removed": removed_files, "history_entries_scrubbed": scrubbed},
                            reason="Personal data anonymised after the retention period", source="web" if actor else "cli"))
    return {"user_id": u.id, "documents_removed": removed_files, "history_entries_scrubbed": scrubbed}
