# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Users, teams, work schedules, entitlements and balance adjustments."""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from ..errors import Conflict, Forbidden, NotFound, Validation
from ..extensions import db
from ..models import (
    CAPABILITIES,
    LEAD_ROLES,
    ROLE_ADMIN,
    ROLE_EMPLOYEE,
    WEEKDAYS,
    AuthToken,
    BalanceAdjustment,
    HolidayCalendar,
    Team,
    TeamLead,
    User,
    VacationEntitlement,
    WorkSchedule,
)
from ..security import new_token, token_hash
from ..timeutil import is_valid_tz, iso, local_today, utcnow
from . import mail, notifications, permissions, revisions
from . import settings as settings_svc

INVITE_TTL = timedelta(hours=72)
RESET_TTL = timedelta(hours=1)


_EMAIL_RE = re.compile(r"^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
                       r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")


def normalize_email(email: str) -> str:
    """Lower-cased, strictly validated (one address, no separators or control characters)."""
    email = (email or "").strip().lower()
    if len(email) > 254 or not _EMAIL_RE.match(email) or ".." in email or email.startswith("."):
        raise Validation("Invalid email address", fields={"email": "invalid"})
    return email


def invalidate_links(u: User) -> None:
    """Expire every outstanding invitation / reset link of a user."""
    now = utcnow()
    for tok in db.session.scalars(db.select(AuthToken).where(AuthToken.user_id == u.id, AuthToken.used_at.is_(None))):
        tok.used_at = now


# --------------------------------------------------------------------------- serialization

def serialize_user(u: User, *, detail: bool = False) -> dict[str, Any]:
    data = {
        "id": u.id, "email": u.email, "name": u.name, "role": u.role, "team_id": u.team_id,
        "team_name": u.team.name if u.team else None, "is_lead": u.is_lead, "is_active": u.is_active,
        "capabilities": sorted(u.capabilities or []),
        "timezone": u.timezone, "locale": u.locale, "time_format": u.time_format or "24h",
        "employment_start": u.employment_start.isoformat() if u.employment_start else None,
        "employment_end": u.employment_end.isoformat() if u.employment_end else None,
        "vacation_days_per_year": u.vacation_days_per_year,
        "holiday_calendar_id": u.holiday_calendar_id,
        "invite_pending": u.password_hash is None,
        "mfa_enabled": u.totp_enabled_at is not None and bool(u.totp_secret),
        "last_login_at": iso(u.last_login_at), "created_at": iso(u.created_at),
    }
    if detail:
        data["schedules"] = [serialize_schedule(s) for s in u.schedules]
        data["notify_email_on_correction"] = u.notify_email_on_correction
        data["led_team_ids"] = [t.id for t in u.led_teams]
    return data


def serialize_lead_row(r: TeamLead) -> dict[str, Any]:
    return {"id": r.id, "team_id": r.team_id, "user_id": r.user_id, "name": r.user.name if r.user else None,
            "role": r.role, "valid_from": r.valid_from.isoformat() if r.valid_from else None,
            "valid_to": r.valid_to.isoformat() if r.valid_to else None,
            "active": r.is_active_on(local_today(settings_svc.get("default_timezone"))) and bool(r.user and r.user.is_active)}


def serialize_team(t: Team) -> dict[str, Any]:
    rows = sorted(t.lead_rows, key=lambda r: (r.role != "lead", r.valid_from or date.min, r.id))
    leads = [serialize_lead_row(r) for r in rows]
    return {"id": t.id, "name": t.name, "color": t.color, "holiday_calendar_id": t.holiday_calendar_id,
            "leads": leads, "lead_names": [r["name"] for r in leads if r["active"] and r["role"] == "lead"],
            "deputy_names": [r["name"] for r in leads if r["active"] and r["role"] == "deputy"],
            "member_count": len([m for m in t.members if m.is_active]),
            "member_ids": [m.id for m in t.members if m.is_active]}


def serialize_schedule(s: WorkSchedule) -> dict[str, Any]:
    return {"id": s.id, "user_id": s.user_id, "valid_from": s.valid_from.isoformat(),
            "pensum_percent": s.pensum_percent, "minutes": s.as_dict(), "weekly_minutes": s.weekly_minutes}


# --------------------------------------------------------------------------- users

def _validate_user_fields(data: dict[str, Any]) -> None:
    if data.get("timezone") is not None and not is_valid_tz(data["timezone"]):
        raise Validation("Unknown timezone", fields={"timezone": "invalid"})
    if data.get("locale") is not None and data["locale"] not in ("en", "de", "fr"):
        raise Validation("Unsupported language", fields={"locale": "invalid"})
    if data.get("time_format") is not None and data["time_format"] not in ("24h", "12h"):
        raise Validation("Unsupported time format", fields={"time_format": "invalid"})
    if "role" in data and data["role"] not in (ROLE_ADMIN, ROLE_EMPLOYEE):
        raise Validation("Invalid role", fields={"role": "invalid"})
    if data.get("capabilities") is not None and not set(data["capabilities"]) <= set(CAPABILITIES):
        raise Validation("Unknown capability", fields={"capabilities": "invalid"})
    if "team_id" in data and data["team_id"] is not None and db.session.get(Team, data["team_id"]) is None:
        raise Validation("Unknown team", fields={"team_id": "invalid"})
    if data.get("holiday_calendar_id") is not None and \
            db.session.get(HolidayCalendar, data["holiday_calendar_id"]) is None:
        raise Validation("Unknown holiday calendar", fields={"holiday_calendar_id": "invalid"})
    s, e = data.get("employment_start"), data.get("employment_end")
    if s and e and e < s:
        raise Validation("Employment end is before start", fields={"employment_end": "before_start"})
    if data.get("vacation_days_per_year") is not None and not (0 <= float(data["vacation_days_per_year"]) <= 366):
        raise Validation("Invalid vacation days", fields={"vacation_days_per_year": "invalid"})
    if "name" in data and not (data["name"] or "").strip():
        raise Validation("Name is required", fields={"name": "required"})
    if "name" in data and re.search(r"[\x00-\x1f\x7f]", data["name"] or ""):
        raise Validation("Name contains invalid characters", fields={"name": "invalid"})


def default_schedule_minutes(pensum: float = 100.0) -> dict[str, int]:
    daily = round(int(settings_svc.get("fulltime_weekly_minutes")) / 5 * pensum / 100)
    return {w: (daily if i < 5 else 0) for i, w in enumerate(WEEKDAYS)}


def create_user(actor: User | None, data: dict[str, Any], *, send_invite: bool = True,
                password: str | None = None) -> User:
    email = normalize_email(data["email"])
    if db.session.scalar(db.select(User.id).where(User.email == email)):
        raise Conflict("A user with this email already exists", code="email_taken", fields={"email": "taken"})
    _validate_user_fields(data)
    tz = data.get("timezone") or settings_svc.get("default_timezone")
    u = User(
        email=email, name=data["name"].strip()[:120], role=data.get("role", ROLE_EMPLOYEE),
        team_id=data.get("team_id"), holiday_calendar_id=data.get("holiday_calendar_id"),
        timezone=tz, locale=data.get("locale") or settings_svc.get("default_locale"),
        time_format=data.get("time_format") or "24h",
        # Target hours and vacation start on the employment start; "unknown" means today, never
        # 1 January (which would open the account with months of minus hours).
        employment_start=data.get("employment_start") or local_today(tz),
        employment_end=data.get("employment_end"),
        vacation_days_per_year=float(data.get("vacation_days_per_year")
                                     if data.get("vacation_days_per_year") is not None
                                     else settings_svc.get("default_vacation_days")),
        capabilities=sorted(set(data.get("capabilities") or [])),
    )
    if password:
        from ..security import hash_password

        u.password_hash = hash_password(password)
        u.password_changed_at = utcnow()
    db.session.add(u)
    db.session.flush()
    pensum = float(data.get("pensum_percent", 100.0))
    minutes = data.get("schedule_minutes") or default_schedule_minutes(pensum)
    valid_from = u.employment_start
    sched = WorkSchedule(user_id=u.id, valid_from=valid_from, pensum_percent=pensum,
                         **{f"minutes_{w}": int(minutes.get(w, 0)) for w in WEEKDAYS})
    db.session.add(sched)
    revisions.record(obj=u, action="create", actor=actor, subject_user_id=u.id, before=None)
    revisions.record(obj=sched, action="create", actor=actor, subject_user_id=u.id, before=None)
    if data.get("opening_balance_min"):
        db.session.add(BalanceAdjustment(user_id=u.id, account="time", amount=float(data["opening_balance_min"]),
                                         effective_date=valid_from, kind="opening",
                                         reason="Opening balance", created_by_id=actor.id if actor else None))
    if send_invite and not password:
        send_invite_mail(u, actor)
    return u


def update_user(actor: User, u: User, data: dict[str, Any]) -> User:
    _validate_user_fields(data)
    before = revisions.snapshot(u)
    old_email = None
    if "email" in data:
        email = normalize_email(data["email"])
        if email != u.email and db.session.scalar(db.select(User.id).where(User.email == email)):
            raise Conflict("A user with this email already exists", code="email_taken", fields={"email": "taken"})
        if email != u.email:
            old_email = u.email
        u.email = email
    for key in ("employment_start", "employment_end"):
        if key in data and data[key] != getattr(u, key):
            from . import signoffs

            candidates = [d for d in (data[key], getattr(u, key)) if d is not None]
            if candidates:
                signoffs.ensure_schedule_change_allowed(u, min(candidates))
    if data.get("role") == ROLE_EMPLOYEE and u.is_admin:
        _ensure_other_admin(u)
    if data.get("is_active") is False:
        if u.id == actor.id:
            raise Conflict("You cannot deactivate yourself", code="self_deactivate")
        if u.is_admin:
            _ensure_other_admin(u)
    for key in ("name", "role", "team_id", "holiday_calendar_id", "timezone", "locale", "time_format", "employment_start",
                "employment_end", "vacation_days_per_year", "is_active"):
        if key in data:
            setattr(u, key, data[key].strip() if key == "name" else data[key])
    if data.get("capabilities") is not None:
        u.capabilities = sorted(set(data["capabilities"]))
    if revisions.snapshot(u) != before:
        revisions.record(obj=u, action="update", actor=actor, subject_user_id=u.id, before=before)
    if old_email is not None:
        # The old mailbox may be compromised or gone: end every session/token and pending link,
        # and tell the old address so a hijack is noticed.
        from ..auth import revoke_user_sessions, revoke_user_tokens

        invalidate_links(u)
        revoke_user_sessions(u.id)
        revoke_user_tokens(u.id)
        if u.password_hash is not None:
            mail.send(mail.build("email_changed", old_email, u.locale, user=u, actor=actor, new_email=u.email))
    if data.get("is_active") is False:
        from ..auth import revoke_user_sessions, revoke_user_tokens
        from . import entries

        invalidate_links(u)
        revoke_user_sessions(u.id)
        revoke_user_tokens(u.id)
        entries.stop_running(u, actor, reason="Account deactivated")
        for row in db.session.scalars(db.select(TeamLead).where(TeamLead.user_id == u.id)):
            _log_lead_change(actor, row, "delete")
            db.session.delete(row)
    return u


def _ensure_other_admin(u: User) -> None:
    others = db.session.scalar(db.select(db.func.count(User.id)).where(
        User.role == ROLE_ADMIN, User.is_active.is_(True), User.id != u.id)) or 0
    if others == 0:
        raise Conflict("At least one active administrator is required", code="last_admin")


def update_profile(u: User, data: dict[str, Any]) -> User:
    allowed = {k: v for k, v in data.items() if k in ("name", "timezone", "locale", "time_format", "notify_email_on_correction")}
    _validate_user_fields(allowed)
    for k, v in allowed.items():
        setattr(u, k, v.strip() if isinstance(v, str) else v)
    return u


def list_users(actor: User, include_inactive: bool = False) -> list[User]:
    ids = permissions.visible_user_ids(actor)
    q = db.select(User)
    if ids is not None:
        q = q.where(User.id.in_(ids))
    if not include_inactive:
        q = q.where(User.is_active.is_(True))
    return list(db.session.scalars(q.order_by(User.name)))


# --------------------------------------------------------------------------- invite / reset

def _issue_token(u: User, purpose: str, ttl: timedelta) -> str:
    now = utcnow()
    for old in db.session.scalars(db.select(AuthToken).where(
            AuthToken.user_id == u.id, AuthToken.purpose == purpose, AuthToken.used_at.is_(None))):
        old.used_at = now  # invalidate previous links
    raw = new_token(32)
    db.session.add(AuthToken(user_id=u.id, purpose=purpose, token_hash=token_hash(raw), expires_at=now + ttl))
    return raw


MFA_TTL = timedelta(minutes=5)


def issue_mfa_token(u: User) -> str:
    """Short-lived token bridging the password step and the second factor of a sign-in."""
    return _issue_token(u, "mfa", MFA_TTL)


def send_invite_mail(u: User, actor: User | None) -> None:
    from flask import current_app

    raw = _issue_token(u, "invite", INVITE_TTL)
    link = f"{current_app.config['BASE_URL']}/invite#token={raw}"  # fragment: never sent to the server/logs
    mail.send(mail.build("invite", u.email, u.locale, user=u, actor=actor, link=link,
                         hours=int(INVITE_TTL.total_seconds() // 3600)))


def send_reset_mail(u: User) -> None:
    from flask import current_app

    raw = _issue_token(u, "reset", RESET_TTL)
    link = f"{current_app.config['BASE_URL']}/reset#token={raw}"
    mail.send(mail.build("password_reset", u.email, u.locale, user=u, link=link, minutes=60))


def admin_set_password(actor: User, u: User, password: str, notify: bool = True) -> None:
    """An administrator sets a user's password (policy applies, sessions revoked, logged)."""
    from ..auth import revoke_user_sessions
    from ..models import Revision
    from ..security import hash_password, password_problems

    if actor.id == u.id:
        raise Validation("Use your profile to change your own password", code="use_profile")
    from flask import current_app

    problems = password_problems(password, u.email, u.name, online=bool(current_app.config["PWNED_PASSWORDS_CHECK"]))
    if problems:
        raise Validation("The password does not meet the policy", code="weak_password", fields={"password": problems[0]})
    u.password_hash = hash_password(password)
    u.password_changed_at = utcnow()
    invalidate_links(u)  # pending invite / reset links become invalid
    revoked = revoke_user_sessions(u.id)
    from ..auth import revoke_user_tokens

    revoke_user_tokens(u.id)
    db.session.add(Revision(entity="user", entity_id=u.id, subject_user_id=u.id, actor_id=actor.id,
                            action="password_set", before=None, after={"sessions_revoked": revoked},
                            reason="Password set by administrator", source="web"))
    notifications.notify(u, "password_set_by_admin", actor_name=actor.name)
    if notify and u.is_active:
        mail.send(mail.build("password_set_by_admin", u.email, u.locale, user=u, actor=actor))


def consume_token(raw: str, purposes: tuple[str, ...]) -> AuthToken:
    tok = db.session.scalar(db.select(AuthToken).where(AuthToken.token_hash == token_hash(raw or "")))
    if tok is None or tok.purpose not in purposes or tok.used_at is not None or tok.expires_at <= utcnow():
        raise Validation("This link is invalid or has expired", code="invalid_token", fields={"token": "invalid"})
    return tok


# --------------------------------------------------------------------------- teams

def save_team(actor: User, data: dict[str, Any], team: Team | None = None) -> Team:
    name = (data.get("name") or (team.name if team else "")).strip()
    if not name:
        raise Validation("Team name is required", fields={"name": "required"})
    clash = db.session.scalar(db.select(Team.id).where(Team.name == name))
    if clash and (team is None or clash != team.id):
        raise Conflict("A team with this name already exists", fields={"name": "taken"})
    if team is None:
        team = Team(name=name)
        db.session.add(team)
    team.name = name[:120]
    if "color" in data:
        team.color = data["color"] or "#35a1cc"
    if "holiday_calendar_id" in data:
        if data["holiday_calendar_id"] is not None and \
                db.session.get(HolidayCalendar, data["holiday_calendar_id"]) is None:
            raise Validation("Unknown holiday calendar", fields={"holiday_calendar_id": "invalid"})
        team.holiday_calendar_id = data["holiday_calendar_id"]
    db.session.flush()
    if "leads" in data and data["leads"] is not None:
        sync_team_leads(actor, team, data["leads"])
    if "member_ids" in data:
        ids = set(data["member_ids"] or [])
        for u in db.session.scalars(db.select(User).where(db.or_(User.team_id == team.id, User.id.in_(ids)))):
            new_team = team.id if u.id in ids else None
            if u.team_id != new_team:
                before = revisions.snapshot(u)
                u.team_id = new_team
                revisions.record(obj=u, action="update", actor=actor, subject_user_id=u.id, before=before)
    # Note: a lead does not have to be a member of the team they lead.
    return team


def _log_lead_change(actor: User | None, row: TeamLead, action: str) -> None:
    from ..models import Revision

    db.session.add(Revision(entity="team_lead", entity_id=row.id or 0, subject_user_id=row.user_id,
                            actor_id=actor.id if actor else None, action=action,
                            before=None if action == "create" else _lead_data(row),
                            after=_lead_data(row) if action == "create" else None, reason="", source="web"))


def _lead_data(row: TeamLead) -> dict[str, Any]:
    return {"team_id": row.team_id, "team": row.team.name if row.team else None, "role": row.role,
            "valid_from": row.valid_from.isoformat() if row.valid_from else None,
            "valid_to": row.valid_to.isoformat() if row.valid_to else None}


def _check_lead_input(team: Team, data: dict[str, Any]) -> User:
    u = db.session.get(User, data["user_id"])
    if u is None or not u.is_active:
        raise Validation("Unknown user", fields={"user_id": "invalid"})
    if data.get("role", "lead") not in LEAD_ROLES:
        raise Validation("Role must be lead or deputy", fields={"role": "invalid"})
    vf, vt = data.get("valid_from"), data.get("valid_to")
    if vf and vt and vt < vf:
        raise Validation("The end is before the start", fields={"valid_to": "before_start"})
    return u


def add_team_lead(actor: User, team: Team, data: dict[str, Any]) -> TeamLead:
    """Administrators name leads and deputies; a current lead of the team may name deputies."""
    role = data.get("role", "lead")
    if not actor.is_admin:
        mine = {r.team_id for r in permissions.active_lead_rows(user_id=actor.id) if r.role == "lead"}
        if team.id not in mine or role != "deputy":
            raise Forbidden("Team leads can name deputies for their own team; administrators assign leads")
    u = _check_lead_input(team, data)
    for r in team.lead_rows:
        if r.user_id == u.id and r.role == role and r.valid_from == data.get("valid_from") and r.valid_to == data.get("valid_to"):
            raise Conflict("This person already has that role for this team in that period", code="lead_exists")
    row = TeamLead(team_id=team.id, user_id=u.id, role=role, valid_from=data.get("valid_from"),
                   valid_to=data.get("valid_to"), created_by_id=actor.id)
    db.session.add(row)
    db.session.flush()
    _log_lead_change(actor, row, "create")
    notifications.notify(u, "lead_assigned", team=team.name, role=role, actor_name=actor.name,
                         valid_from=row.valid_from.isoformat() if row.valid_from else None,
                         valid_to=row.valid_to.isoformat() if row.valid_to else None)
    return row


def remove_team_lead(actor: User, row: TeamLead) -> None:
    if not actor.is_admin:
        mine = {r.team_id for r in permissions.active_lead_rows(user_id=actor.id) if r.role == "lead"}
        if row.team_id not in mine or row.role != "deputy":
            raise Forbidden("Team leads can remove deputies of their own team; administrators remove leads")
    _log_lead_change(actor, row, "delete")
    db.session.delete(row)


def sync_team_leads(actor: User, team: Team, rows: list[dict[str, Any]]) -> None:
    """Replace the lead/deputy rows of a team with the given list (administrators)."""
    if not actor.is_admin:
        raise Forbidden("Only administrators change the leads of a team")
    wanted = {(r["user_id"], r.get("role", "lead"), r.get("valid_from"), r.get("valid_to")) for r in rows}
    for existing in list(team.lead_rows):
        key = (existing.user_id, existing.role, existing.valid_from, existing.valid_to)
        if key not in wanted:
            remove_team_lead(actor, existing)
        else:
            wanted.discard(key)
    for user_id, role, vf, vt in wanted:
        add_team_lead(actor, team, {"user_id": user_id, "role": role, "valid_from": vf, "valid_to": vt})


def delete_team(team: Team) -> None:
    for u in team.members:
        u.team_id = None
    db.session.delete(team)


# --------------------------------------------------------------------------- schedules

def save_schedule(actor: User, user: User, data: dict[str, Any], schedule: WorkSchedule | None = None) -> WorkSchedule:
    if not permissions.can_edit_schedule(actor, user):
        raise Forbidden("Not allowed to change work schedules")
    valid_from: date = data.get("valid_from") or (schedule.valid_from if schedule else None)
    if valid_from is None:
        raise Validation("valid_from is required", fields={"valid_from": "required"})
    minutes = data.get("minutes") or {}
    for w in WEEKDAYS:
        v = int(minutes.get(w, getattr(schedule, f"minutes_{w}", 0) if schedule else 0))
        if not 0 <= v <= 1440:
            raise Validation("Daily minutes must be between 0 and 1440", fields={f"minutes.{w}": "invalid"})
        minutes[w] = v
    pensum = float(data.get("pensum_percent", schedule.pensum_percent if schedule else 100.0))
    if not 0 < pensum <= 100:
        raise Validation("Employment level must be between 1 and 100 %", fields={"pensum_percent": "invalid"})
    from . import signoffs

    signoffs.ensure_schedule_change_allowed(user, valid_from)
    if schedule is not None:
        signoffs.ensure_schedule_change_allowed(user, schedule.valid_from)
    clash = db.session.scalar(db.select(WorkSchedule).where(
        WorkSchedule.user_id == user.id, WorkSchedule.valid_from == valid_from))
    if clash is not None and (schedule is None or clash.id != schedule.id):
        schedule = clash
    before = revisions.snapshot(schedule) if schedule else None
    if schedule is None:
        schedule = WorkSchedule(user_id=user.id, valid_from=valid_from)
        db.session.add(schedule)
    schedule.valid_from = valid_from
    schedule.pensum_percent = pensum
    for w in WEEKDAYS:
        setattr(schedule, f"minutes_{w}", minutes[w])
    revisions.record(obj=schedule, action="update" if before else "create", actor=actor,
                     subject_user_id=user.id, before=before, reason=data.get("reason", ""))
    return schedule


def delete_schedule(actor: User, schedule: WorkSchedule) -> None:
    user = db.session.get(User, schedule.user_id)
    if not permissions.can_edit_schedule(actor, user):
        raise Forbidden("Not allowed to change work schedules")
    count = db.session.scalar(db.select(db.func.count(WorkSchedule.id)).where(WorkSchedule.user_id == user.id))
    if count <= 1:
        raise Conflict("A user needs at least one work schedule", code="last_schedule")
    from . import signoffs

    signoffs.ensure_schedule_change_allowed(user, schedule.valid_from)
    before = revisions.snapshot(schedule)
    revisions.record(obj=schedule, action="delete", actor=actor, subject_user_id=user.id, before=before)
    db.session.delete(schedule)


# --------------------------------------------------------------------------- entitlements / adjustments

def set_entitlement(actor: User, user: User, year: int, days: float | None, note: str = "") -> None:
    if not permissions.can_adjust_balance(actor, user):
        raise Forbidden("Not allowed to change vacation entitlements")
    row = db.session.scalar(db.select(VacationEntitlement).where(
        VacationEntitlement.user_id == user.id, VacationEntitlement.year == year))
    if days is None:
        if row is not None:
            before = revisions.snapshot(row)
            revisions.record(obj=row, action="delete", actor=actor, subject_user_id=user.id, before=before,
                             reason=note)
            db.session.delete(row)
        return
    if not 0 <= days <= 366:
        raise Validation("Invalid number of days", fields={"days": "invalid"})
    before = revisions.snapshot(row) if row else None
    if row is None:
        row = VacationEntitlement(user_id=user.id, year=year, days=days, note=note)
        db.session.add(row)
    row.days, row.note = days, note
    revisions.record(obj=row, action="update" if before else "create", actor=actor, subject_user_id=user.id,
                     before=before, reason=note)


def add_adjustment(actor: User, user: User, data: dict[str, Any]) -> BalanceAdjustment:
    if not permissions.can_adjust_balance(actor, user):
        raise Forbidden("Not allowed to adjust balances")
    if data.get("account") not in ("time", "vacation"):
        raise Validation("Invalid account", fields={"account": "invalid"})
    if data.get("kind", "correction") not in ("opening", "payout", "correction"):
        raise Validation("Invalid kind", fields={"kind": "invalid"})
    reason = (data.get("reason") or "").strip()
    if not reason:
        raise Validation("A reason is required", fields={"reason": "required"})
    amount = float(data["amount"])
    if amount == 0:
        raise Validation("Amount must not be zero", fields={"amount": "zero"})
    from . import signoffs

    signoffs.ensure_open_dates(user, data.get("effective_date") or local_today(user.timezone))
    adj = BalanceAdjustment(user_id=user.id, account=data["account"], amount=amount,
                            effective_date=data.get("effective_date") or local_today(user.timezone),
                            kind=data.get("kind", "correction"), reason=reason[:500], created_by_id=actor.id)
    db.session.add(adj)
    revisions.record(obj=adj, action="create", actor=actor, subject_user_id=user.id, before=None, reason=reason)
    if actor.id != user.id:
        notifications.notify(user, "balance_adjusted", account=adj.account, amount=amount, reason=reason,
                             actor_name=actor.name)
    return adj


def delete_adjustment(actor: User, adj: BalanceAdjustment, reason: str) -> None:
    user = db.session.get(User, adj.user_id)
    if not permissions.can_adjust_balance(actor, user):
        raise Forbidden("Not allowed to adjust balances")
    if not reason.strip():
        raise Validation("A reason is required", fields={"reason": "required"})
    from . import signoffs

    signoffs.ensure_open_dates(user, adj.effective_date)
    before = revisions.snapshot(adj)
    adj.is_deleted = True
    revisions.record(obj=adj, action="delete", actor=actor, subject_user_id=user.id, before=before, reason=reason)


def get_or_404(model: Any, ident: int, label: str = "Item") -> Any:
    obj = db.session.get(model, ident)
    if obj is None:
        raise NotFound(f"{label} not found")
    return obj
