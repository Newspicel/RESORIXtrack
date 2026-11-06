# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Reports (JSON / PDF / XLSX / CSV)."""

from __future__ import annotations

from flask import jsonify
from flask_smorest import Blueprint

from ..auth import scope_required
from ..errors import Forbidden, Validation
from ..extensions import db
from ..models import User
from ..services import permissions, reports
from . import schemas as s
from .common import MIMETYPES, file_response, me

bp = Blueprint("reports", __name__, url_prefix="/api/v1/reports", description="Reports and exports")


def _scope_users(team_id: int | None, user_id: int | None = None, period_start=None) -> list[User]:
    """Active users, plus deactivated ones whose employment reached into the period (leavers keep
    appearing in the reports of the months they worked)."""
    visible = permissions.visible_user_ids(me())
    q = db.select(User)
    if period_start is not None:
        q = q.where(db.or_(User.is_active.is_(True), db.and_(User.employment_end.is_not(None),
                                                             User.employment_end >= period_start)))
    else:
        q = q.where(User.is_active.is_(True))
    if visible is not None:
        q = q.where(User.id.in_(visible))
    if team_id:
        q = q.where(User.team_id == team_id)
    if user_id:
        q = q.where(User.id == user_id)
    return list(db.session.scalars(q.order_by(User.name)))


def _send(data, fmt: str, filename: str):
    if fmt == "json":
        return jsonify(data)
    if fmt == "pdf":
        content = reports.to_pdf(data, me().locale)
    elif fmt == "xlsx":
        content = reports.to_xlsx(data, me().locale)
    else:
        content = reports.to_csv(data, me().locale)
    return file_response(content, MIMETYPES[fmt], f"{filename}.{fmt}")


@bp.route("/timesheet", methods=["GET"])
@scope_required("reports:read", "entries:read")
@bp.arguments(s.TimesheetQuery, location="query")
def timesheet(args):
    """Monthly timesheet of one employee."""
    user = me() if not args.get("user_id") else permissions.require_view(me(), args["user_id"])
    data = reports.timesheet(user, args["year"], args["month"])
    slug = user.name.lower().replace(" ", "-")
    return _send(data, args["format"], f"timesheet-{slug}-{args['year']}-{args['month']:02d}")


@bp.route("/balances", methods=["GET"])
@scope_required("reports:read")
@bp.arguments(s.BalancesQuery, location="query")
def balances(args):
    """Target / worked / balance / vacation per person (leads: own teams, admin: all)."""
    from datetime import date

    period_start = date(args["year"], args.get("month") or 1, 1)
    users = _scope_users(args.get("team_id"), period_start=period_start)
    data = reports.balances(users, args["year"], args.get("month"))
    suffix = f"{args['year']}-{args['month']:02d}" if args.get("month") else str(args["year"])
    return _send(data, args["format"], f"balances-{suffix}")


@bp.route("/absences", methods=["GET"])
@scope_required("reports:read")
@bp.arguments(s.ReportRangeQuery, location="query")
def absences(args):
    users = _scope_users(args.get("team_id"), args.get("user_id"), period_start=args["from_"])
    data = reports.absences_overview(users, args["from_"], args["to"])
    return _send(data, args["format"], f"absences-{args['from_']}-{args['to']}")


@bp.route("/projects", methods=["GET"])
@scope_required("reports:read")
@bp.arguments(s.ReportRangeQuery, location="query")
def projects(args):
    """Logged hours per project and person (own data for employees; teams for leads; all for admins)."""
    from ..services import worklog

    users = _scope_users(args.get("team_id"), args.get("user_id"), period_start=args["from_"])
    data = worklog.project_report(users, args["from_"], args["to"])
    return _send(data, args["format"], f"projects-{args['from_']}-{args['to']}")


@bp.route("/entries", methods=["GET"])
@scope_required("reports:read")
@bp.arguments(s.ReportRangeQuery, location="query")
def raw(args):
    """Raw export of all time entries (incl. deleted, flagged) - leads for their teams, admin for all."""
    if not permissions.is_manager(me()):
        raise Forbidden("Only team leads and HR can export raw data")
    users = _scope_users(args.get("team_id"), args.get("user_id"), period_start=args["from_"])
    rows = reports.raw_entries(users, args["from_"], args["to"])
    fmt = args["format"]
    name = f"entries-{args['from_']}-{args['to']}"
    if fmt == "json":
        return jsonify(rows)
    if fmt == "pdf":
        raise Validation("Raw export is available as CSV, XLSX or JSON", fields={"format": "invalid"})
    content = reports.raw_to_xlsx(rows, me().locale) if fmt == "xlsx" else reports.to_csv(rows, me().locale)
    return file_response(content, MIMETYPES[fmt], f"{name}.{fmt}")
