# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Users, teams, work schedules and holiday calendars."""

from __future__ import annotations

from datetime import date

from flask import jsonify, request
from flask_smorest import Blueprint

from ..auth import admin_required, login_required, scope_required
from ..errors import Conflict, Forbidden, NotFound, Validation
from ..extensions import db
from ..models import Holiday, Team, User, WorkSchedule
from ..services import holidays as hol
from ..services import permissions
from ..services import users as svc
from . import schemas as s
from .common import file_response, me, ok

bp = Blueprint("org", __name__, url_prefix="/api/v1", description="Users, teams, schedules, holidays")


# --------------------------------------------------------------------------- users

@bp.route("/users", methods=["GET"])
@login_required
def list_users():
    """Admins see everyone; leads see their team members; employees see themselves."""
    include_inactive = request.args.get("include_inactive") == "1" and (me().is_admin or me().is_hr)
    return jsonify([svc.serialize_user(u) for u in svc.list_users(me(), include_inactive)])


@bp.route("/users", methods=["POST"])
@admin_required
@bp.arguments(s.UserIn)
def create_user(data):
    """Create an employee; an invitation email with a set-password link is sent."""
    send_invite = data.pop("send_invite", True)
    u = svc.create_user(me(), data, send_invite=send_invite)
    db.session.commit()
    return ok(svc.serialize_user(u, detail=True), 201)


@bp.route("/users/<int:user_id>", methods=["GET"])
@login_required
def get_user(user_id: int):
    return jsonify(svc.serialize_user(permissions.require_profile(me(), user_id), detail=True))


@bp.route("/users/<int:user_id>", methods=["PATCH"])
@admin_required
@bp.arguments(s.UserPatch)
def patch_user(data, user_id: int):
    u = permissions.get_user_or_404(user_id)
    svc.update_user(me(), u, data)
    db.session.commit()
    return jsonify(svc.serialize_user(u, detail=True))


@bp.route("/users/<int:user_id>/invite", methods=["POST"])
@admin_required
def resend_invite(user_id: int):
    """(Re-)send the invitation, or a password reset link if the user already has a password."""
    u = permissions.get_user_or_404(user_id)
    if u.password_hash is None:
        svc.send_invite_mail(u, me())
    else:
        svc.send_reset_mail(u)
    db.session.commit()
    return ok()


@bp.route("/users/<int:user_id>/password", methods=["POST"])
@admin_required
@bp.arguments(s.SetPasswordIn)
def set_password(data, user_id: int):
    """Administrators: set a user's password. The user's sessions are signed out; optional email notice."""
    from ..security import verify_password

    u = permissions.get_user_or_404(user_id)
    if not verify_password(me().password_hash, data["admin_password"]):
        raise Validation("Your password is incorrect", fields={"admin_password": "invalid"})
    svc.admin_set_password(me(), u, data["password"], notify=data["notify"])
    db.session.commit()
    return ok()


@bp.route("/users/<int:user_id>/mfa/reset", methods=["POST"])
@admin_required
@bp.arguments(s.AnonymizeIn)
def reset_mfa(data, user_id: int):
    """Administrators: remove two-factor authentication from an account (lost phone). Password confirmation."""
    from ..models import Revision
    from ..security import verify_password
    from ..services import mfa

    u = permissions.get_user_or_404(user_id)
    if not verify_password(me().password_hash, data["admin_password"]):
        raise Validation("Your password is incorrect", fields={"admin_password": "invalid"})
    mfa.admin_reset(u)
    db.session.add(Revision(entity="user", entity_id=u.id, subject_user_id=u.id, actor_id=me().id, action="mfa_reset",
                            before=None, after=None, reason="Reset by administrator", source="web"))
    db.session.commit()
    return ok()


@bp.route("/users/<int:user_id>/export", methods=["GET"])
@login_required
def export_user(user_id: int):
    """HR: everything stored about a person as one JSON file (data-access requests). The export contains
    time data, so administrators need the HR capability for it."""
    from ..services import privacy

    if not me().is_hr:
        raise Forbidden("The HR capability is required to export a person's data")
    u = permissions.get_user_or_404(user_id)
    slug = u.email.split("@")[0].replace(".", "-")
    return file_response(privacy.export_user_json(u), "application/json", f"resorixtrack-export-{slug}.json")


@bp.route("/users/<int:user_id>/anonymize", methods=["POST"])
@admin_required
@bp.arguments(s.AnonymizeIn)
def anonymize_user(data, user_id: int):
    """Administrators: irreversibly anonymise a deactivated former employee (password confirmation required)."""
    from ..security import verify_password
    from ..services import privacy

    u = permissions.get_user_or_404(user_id)
    if not verify_password(me().password_hash, data["admin_password"]):
        raise Validation("Your password is incorrect", fields={"admin_password": "invalid"})
    if u.id == me().id:
        raise Conflict("You cannot anonymise your own account", code="self_anonymize")
    result = privacy.anonymize_user(me(), u, retention_days=0, force=bool(data.get("force")))
    db.session.commit()
    return ok(result)


@bp.route("/users/<int:user_id>/schedules", methods=["GET"])
@login_required
def list_schedules(user_id: int):
    u = permissions.require_profile(me(), user_id)
    return jsonify([svc.serialize_schedule(x) for x in u.schedules])


@bp.route("/users/<int:user_id>/schedules", methods=["POST"])
@scope_required("admin", "entries:write")
@bp.arguments(s.ScheduleIn)
def add_schedule(data, user_id: int):
    """Add a schedule version valid from `valid_from` (contract change)."""
    u = permissions.require_view(me(), user_id)
    sched = svc.save_schedule(me(), u, data)
    db.session.commit()
    return ok(svc.serialize_schedule(sched), 201)


@bp.route("/schedules/<int:schedule_id>", methods=["PATCH"])
@scope_required("admin", "entries:write")
@bp.arguments(s.SchedulePatch)
def patch_schedule(data, schedule_id: int):
    sched = svc.get_or_404(WorkSchedule, schedule_id, "Schedule")
    u = permissions.require_view(me(), sched.user_id)
    svc.save_schedule(me(), u, data, sched)
    db.session.commit()
    return jsonify(svc.serialize_schedule(sched))


@bp.route("/schedules/<int:schedule_id>", methods=["DELETE"])
@scope_required("admin", "entries:write")
def delete_schedule(schedule_id: int):
    sched = svc.get_or_404(WorkSchedule, schedule_id, "Schedule")
    permissions.require_view(me(), sched.user_id)
    svc.delete_schedule(me(), sched)
    db.session.commit()
    return ok()


# --------------------------------------------------------------------------- teams

@bp.route("/teams", methods=["GET"])
@login_required
def list_teams():
    q = db.select(Team).order_by(Team.name)
    if not (me().is_admin or me().is_hr):
        ids = permissions.led_team_ids(me()) | ({me().team_id} if me().team_id else set())
        q = q.where(Team.id.in_(ids))
    return jsonify([svc.serialize_team(t) for t in db.session.scalars(q)])


@bp.route("/teams/<int:team_id>/leads", methods=["GET"])
@login_required
def list_team_leads(team_id: int):
    """Leads and deputies of a team with their periods (administrators, HR, the team's leads and members)."""
    t = svc.get_or_404(Team, team_id, "Team")
    if not (me().is_admin or me().is_hr or team_id in permissions.led_team_ids(me()) or me().team_id == team_id):
        raise NotFound("Team not found")
    rows = sorted(t.lead_rows, key=lambda r: (r.role != "lead", r.valid_from or date.min, r.id))
    return jsonify([svc.serialize_lead_row(r) for r in rows])


@bp.route("/teams/<int:team_id>/leads", methods=["POST"])
@bp.arguments(s.TeamLeadIn)
@login_required
def add_team_lead(data, team_id: int):
    """Name a lead (administrators) or a deputy (administrators and the team's current leads), for a period or open-ended."""
    t = svc.get_or_404(Team, team_id, "Team")
    row = svc.add_team_lead(me(), t, data)
    db.session.commit()
    return ok(svc.serialize_lead_row(row), 201)


@bp.route("/teams/<int:team_id>/leads/<int:row_id>", methods=["DELETE"])
@login_required
def remove_team_lead(team_id: int, row_id: int):
    from ..models import TeamLead

    row = db.session.get(TeamLead, row_id)
    if row is None or row.team_id != team_id:
        raise NotFound("Not found")
    svc.remove_team_lead(me(), row)
    db.session.commit()
    return ok()


@bp.route("/teams", methods=["POST"])
@admin_required
@bp.arguments(s.TeamIn)
def create_team(data):
    t = svc.save_team(me(), data)
    db.session.commit()
    return ok(svc.serialize_team(t), 201)


@bp.route("/teams/<int:team_id>", methods=["PATCH"])
@admin_required
@bp.arguments(s.TeamIn)
def patch_team(data, team_id: int):
    t = svc.get_or_404(Team, team_id, "Team")
    svc.save_team(me(), data, t)
    db.session.commit()
    return jsonify(svc.serialize_team(t))


@bp.route("/teams/<int:team_id>", methods=["DELETE"])
@admin_required
def delete_team(team_id: int):
    svc.delete_team(svc.get_or_404(Team, team_id, "Team"))
    db.session.commit()
    return ok()


# --------------------------------------------------------------------------- holiday calendars

@bp.route("/holiday-calendars", methods=["GET"])
@login_required
def list_calendars():
    from ..models import HolidayCalendar

    rows = db.session.scalars(db.select(HolidayCalendar).order_by(HolidayCalendar.name))
    return jsonify([hol.serialize_calendar(c) for c in rows])


@bp.route("/holiday-calendars/countries", methods=["GET"])
@login_required
def countries():
    """Countries and subdivisions available for import (python-holidays)."""
    return jsonify(hol.supported_countries())


@bp.route("/holiday-calendars/presets/<string:key>", methods=["POST"])
@admin_required
def install_preset(key: str):
    """Install a built-in holiday calendar (e.g. `ch-fr-fribourg`); idempotent."""
    from ..services import presets

    if key not in presets.PRESETS:
        raise NotFound("Unknown preset")
    cal = presets.install_preset(key, make_default=request.args.get("default") == "1")
    db.session.commit()
    return ok(hol.serialize_calendar(cal), 201)


@bp.route("/holiday-calendars", methods=["POST"])
@admin_required
@bp.arguments(s.CalendarIn)
def create_calendar(data):
    c = hol.save_calendar(data)
    db.session.commit()
    return ok(hol.serialize_calendar(c), 201)


@bp.route("/holiday-calendars/<int:cal_id>", methods=["GET"])
@login_required
def get_calendar(cal_id: int):
    year = request.args.get("year", type=int)
    return jsonify(hol.serialize_calendar(hol.get_calendar(cal_id), with_holidays=True, year=year))


@bp.route("/holiday-calendars/<int:cal_id>", methods=["PATCH"])
@admin_required
@bp.arguments(s.CalendarIn)
def patch_calendar(data, cal_id: int):
    c = hol.save_calendar(data, hol.get_calendar(cal_id))
    db.session.commit()
    return jsonify(hol.serialize_calendar(c))


@bp.route("/holiday-calendars/<int:cal_id>", methods=["DELETE"])
@admin_required
def delete_calendar(cal_id: int):
    cal = hol.get_calendar(cal_id)
    from ..services import signoffs

    for h in cal.holidays:
        signoffs.ensure_holiday_change_allowed(h.date)
    db.session.delete(cal)
    db.session.commit()
    return ok()


@bp.route("/holiday-calendars/<int:cal_id>/holidays", methods=["POST"])
@admin_required
@bp.arguments(s.HolidayIn)
def add_holiday(data, cal_id: int):
    h = hol.save_holiday(hol.get_calendar(cal_id), data)
    db.session.commit()
    return ok(hol.serialize_holiday(h), 201)


@bp.route("/holiday-calendars/<int:cal_id>/import", methods=["POST"])
@admin_required
@bp.arguments(s.ImportIn)
def import_holidays(data, cal_id: int):
    """Import statutory holidays for a country / canton / state and year."""
    result = hol.import_holidays(hol.get_calendar(cal_id), data["country"], data.get("subdiv"), data["year"],
                                 include_half_days=data["include_half_days"], replace=data["replace"])
    db.session.commit()
    return jsonify(result)


@bp.route("/holidays/<int:holiday_id>", methods=["PATCH"])
@admin_required
@bp.arguments(s.HolidayPatch)
def patch_holiday(data, holiday_id: int):
    h = db.session.get(Holiday, holiday_id)
    if h is None:
        raise NotFound("Holiday not found")
    hol.save_holiday(h.calendar, data, h)
    db.session.commit()
    return jsonify(hol.serialize_holiday(h))


@bp.route("/holidays/<int:holiday_id>", methods=["DELETE"])
@admin_required
def delete_holiday(holiday_id: int):
    h = db.session.get(Holiday, holiday_id)
    if h is None:
        raise NotFound("Holiday not found")
    from ..services import signoffs

    signoffs.ensure_holiday_change_allowed(h.date)
    db.session.delete(h)
    db.session.commit()
    return ok()


_ = (Forbidden, User)
