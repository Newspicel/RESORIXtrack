# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Work log (what was done on a day) and projects."""

from __future__ import annotations

from flask import jsonify
from flask_smorest import Blueprint

from ..auth import login_required, request_source, scope_required
from ..extensions import db
from ..services import permissions
from ..services import worklog as svc
from . import schemas as s
from .common import me, ok

bp = Blueprint("worklog", __name__, url_prefix="/api/v1", description="Work log and projects")


# --------------------------------------------------------------------------- projects

@bp.route("/projects", methods=["GET"])
@scope_required("entries:read", "entries:write", "clock")
@bp.arguments(s.ProjectQuery, location="query")
def list_projects(args):
    """Projects the caller may book work on (company-wide + own team; leads: led teams; admins: all)."""
    return jsonify([svc.serialize_project(p) for p in svc.visible_projects(me(), include_inactive=args["include_inactive"])])


@bp.route("/projects", methods=["POST"])
@bp.arguments(s.ProjectIn)
@login_required
def create_project(data):
    """Team leads create projects for their teams, administrators for any team or company-wide."""
    p = svc.save_project(me(), data)
    db.session.commit()
    return ok(svc.serialize_project(p), 201)


@bp.route("/projects/<int:project_id>", methods=["PATCH"])
@bp.arguments(s.ProjectPatch)
@login_required
def update_project(data, project_id: int):
    """Rename, recolour, move to another team, activate or deactivate."""
    p = svc.save_project(me(), data, svc.get_project_or_404(project_id))
    db.session.commit()
    return ok(svc.serialize_project(p))


# --------------------------------------------------------------------------- work log items

@bp.route("/worklog", methods=["GET"])
@scope_required("entries:read")
@bp.arguments(s.RangeQuery, location="query")
def list_worklog(args):
    """Work log items of a person in a date range (own, or a team member for leads/admins)."""
    user = permissions.require_view(me(), args["user_id"]) if args.get("user_id") else me()
    items = svc.list_logs(user, args["from_"], args["to"])
    return jsonify({"user_id": user.id, "config": svc.config(), "items": [svc.serialize(w) for w in items]})


@bp.route("/worklog/customer-refs", methods=["GET"])
@scope_required("entries:read", "entries:write", "clock")
def customer_refs():
    """Customer references the signed-in person used recently (suggestions for the form)."""
    return jsonify(svc.recent_customer_refs(me()))


@bp.route("/worklog", methods=["POST"])
@scope_required("entries:write", "clock")
@bp.arguments(s.WorkLogIn)
def add_worklog(data):
    """Add what was done on a day: minutes, optional project, free text."""
    owner = permissions.require_view(me(), data["user_id"]) if data.get("user_id") else me()
    w = svc.add_log(me(), owner, data, source=request_source())
    db.session.commit()
    return ok(svc.serialize(w), 201)


@bp.route("/worklog/<int:log_id>", methods=["PATCH"])
@scope_required("entries:write")
@bp.arguments(s.WorkLogPatch)
def update_worklog(data, log_id: int):
    w = svc.get_log_or_404(log_id)
    if not permissions.can_view_user(me(), w.user):
        from ..errors import NotFound

        raise NotFound("Work log item not found")
    w = svc.update_log(me(), w, data, reason=data.get("reason", ""), source=request_source())
    db.session.commit()
    return ok(svc.serialize(w))


@bp.route("/worklog/<int:log_id>", methods=["DELETE"])
@scope_required("entries:write")
@bp.arguments(s.ReasonIn)
def delete_worklog(data, log_id: int):
    w = svc.get_log_or_404(log_id)
    if not permissions.can_view_user(me(), w.user):
        from ..errors import NotFound

        raise NotFound("Work log item not found")
    svc.delete_log(me(), w, reason=data.get("reason", ""), source=request_source())
    db.session.commit()
    return ok()
