# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Who may see and change whose data.

Roles and capabilities:

- *Employee*: own data.
- *Team lead / deputy* (rows in ``team_leads``, optionally limited to a period): the members of that
  team – entries, absences, accounts, corrections, approvals, sign-off, team projects.
- *HR* capability: everyone's time data, reports for all, sign-off of any month (incl. leads),
  reopening, the integrity check.
- *Administrator* (role): users, teams, roles, settings, holidays, branding, backups and logs –
  but **no** time data of others unless they also hold the HR capability.
- *Projects* capability: creates and maintains all projects.
"""

from __future__ import annotations

from datetime import date

from ..errors import Forbidden, NotFound
from ..extensions import db
from ..models import CAP_PROJECTS, Team, TeamLead, User
from ..timeutil import local_today
from . import settings as settings_svc


def _today() -> date:
    return local_today(settings_svc.get("default_timezone"))


def active_lead_rows(team_id: int | None = None, user_id: int | None = None, on: date | None = None) -> list[TeamLead]:
    on = on or _today()
    q = db.select(TeamLead).where(
        db.or_(TeamLead.valid_from.is_(None), TeamLead.valid_from <= on),
        db.or_(TeamLead.valid_to.is_(None), TeamLead.valid_to >= on))
    if team_id is not None:
        q = q.where(TeamLead.team_id == team_id)
    if user_id is not None:
        q = q.where(TeamLead.user_id == user_id)
    return list(db.session.scalars(q.order_by(TeamLead.role, TeamLead.id)))


def led_team_ids(actor: User) -> set[int]:
    """Teams the person leads *today* (as lead or deputy within its period)."""
    return {r.team_id for r in active_lead_rows(user_id=actor.id)}


def team_leaders(team: Team, on: date | None = None) -> list[User]:
    """Active leads and deputies of a team (active accounts only)."""
    return [r.user for r in active_lead_rows(team_id=team.id, on=on) if r.user.is_active]


def leads_user(actor: User, target: User) -> bool:
    if target.team_id is None or target.id == actor.id:
        return False
    return target.team_id in led_team_ids(actor)


def can_view_user(actor: User, target: User) -> bool:
    """Time data (entries, absences, accounts, work log, reports) of ``target``."""
    return actor.id == target.id or actor.is_hr or leads_user(actor, target)


def can_view_profile(actor: User, target: User) -> bool:
    """Profile and contract data (no times): additionally administrators."""
    return actor.is_admin or can_view_user(actor, target)


def require_profile(actor: User, user_id: int) -> User:
    target = get_user_or_404(user_id)
    if not can_view_profile(actor, target):
        raise NotFound("User not found")
    return target


def can_manage_user(actor: User, target: User) -> bool:
    """Correct entries, mark sick, approve/cancel absences, log work of ``target``."""
    if actor.id == target.id:
        return False
    return actor.is_hr or leads_user(actor, target)


def can_edit_schedule(actor: User, target: User) -> bool:
    if actor.is_hr:
        return True
    return leads_user(actor, target) and bool(settings_svc.get("lead_can_edit_schedules"))


def can_adjust_balance(actor: User, target: User) -> bool:
    if actor.is_hr:
        return True
    return leads_user(actor, target) and bool(settings_svc.get("lead_can_adjust_balances"))


def hr_users() -> list[User]:
    return [u for u in db.session.scalars(db.select(User).where(User.is_active.is_(True))) if u.is_hr]


def approvers_for(target: User) -> list[User]:
    """Who decides on ``target``'s requests: the active leads/deputies of their team (never the person
    themselves); otherwise the HR people; as a last resort the administrators, so nothing gets stuck."""
    if target.team_id is not None:
        team = db.session.get(Team, target.team_id)
        leads = [u for u in team_leaders(team) if u.id != target.id] if team else []
        if leads:
            return leads
    hr = [u for u in hr_users() if u.id != target.id]
    if hr:
        return hr
    return [u for u in db.session.scalars(db.select(User).where(User.role == "admin", User.is_active.is_(True)))
            if u.id != target.id]


def can_decide_absence(actor: User, target: User) -> bool:
    return can_manage_user(actor, target)


def can_manage_projects(actor: User, team_id: int | None) -> bool:
    if actor.has_cap(CAP_PROJECTS):
        return True
    return team_id is not None and team_id in led_team_ids(actor)


def get_user_or_404(user_id: int) -> User:
    user = db.session.get(User, user_id)
    if user is None:
        raise NotFound("User not found")
    return user


def require_view(actor: User, user_id: int) -> User:
    target = get_user_or_404(user_id)
    if not can_view_user(actor, target):
        # Don't leak existence of users outside the actor's scope.
        raise NotFound("User not found")
    return target


def require_manage(actor: User, target: User) -> None:
    if not can_manage_user(actor, target):
        raise Forbidden("You can only manage members of teams you lead")


def visible_user_ids(actor: User) -> list[int] | None:
    """None means *all* users (HR capability)."""
    if actor.is_hr:
        return None
    ids = {actor.id}
    teams = led_team_ids(actor)
    if teams:
        ids |= set(db.session.scalars(db.select(User.id).where(User.team_id.in_(teams))))
    return sorted(ids)


def is_manager(actor: User) -> bool:
    """Sees the Team section: leads/deputies and HR."""
    return actor.is_hr or bool(led_team_ids(actor))
