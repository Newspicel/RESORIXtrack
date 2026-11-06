# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Absences: requests, approvals, cancellations, sick reports and attachments."""

from __future__ import annotations

from flask import jsonify, request, send_file
from flask_smorest import Blueprint

from ..auth import admin_required, login_required, request_source, scope_required
from ..errors import Conflict, NotFound, Validation
from ..extensions import db
from ..models import AbsenceType, Team, User
from ..services import absences as svc
from ..services import accounts, permissions, revisions
from ..timeutil import local_today
from . import schemas as s
from .common import me, ok

bp = Blueprint("absences", __name__, url_prefix="/api/v1", description="Absences and vacation workflow")


def _owner(user_id: int | None) -> User:
    if user_id is None or user_id == me().id:
        return me()
    return permissions.require_view(me(), user_id)


def _visible(absence_id: int):
    a = svc.get_absence(absence_id)
    if not permissions.can_view_user(me(), a.user):
        raise NotFound("Absence not found")
    return a


# --------------------------------------------------------------------------- types

@bp.route("/absence-types", methods=["GET"])
@login_required
def list_types():
    rows = db.session.scalars(db.select(AbsenceType).order_by(AbsenceType.sort, AbsenceType.id))
    return jsonify([svc.serialize_type(t) for t in rows])


@bp.route("/absence-types", methods=["POST"])
@admin_required
@bp.arguments(s.AbsenceTypeIn)
def create_type(data):
    if not data.get("key") or not data.get("label"):
        raise Validation("key and label are required", fields={"key": "required"})
    if db.session.scalar(db.select(AbsenceType.id).where(AbsenceType.key == data["key"])):
        raise Conflict("Key already exists", fields={"key": "taken"})
    t = AbsenceType(**data)
    db.session.add(t)
    db.session.commit()
    return ok(svc.serialize_type(t), 201)


@bp.route("/absence-types/<int:type_id>", methods=["PATCH"])
@admin_required
@bp.arguments(s.AbsenceTypeIn)
def patch_type(data, type_id: int):
    t = db.session.get(AbsenceType, type_id)
    if t is None:
        raise NotFound("Type not found")
    data.pop("key", None)  # keys are stable identifiers
    for k, v in data.items():
        setattr(t, k, v)
    db.session.commit()
    return jsonify(svc.serialize_type(t))


# --------------------------------------------------------------------------- queries

@bp.route("/absences", methods=["GET"])
@scope_required("absences:read")
@bp.arguments(s.TeamRangeQuery, location="query")
def list_absences(args):
    """Absences overlapping [from, to]. Filter by `user_id`, `team_id`, `status` (comma separated)."""
    visible = permissions.visible_user_ids(me())
    ids = visible
    if args.get("user_id"):
        _owner(args["user_id"])
        ids = [args["user_id"]]
    elif args.get("team_id"):
        team_members = list(db.session.scalars(db.select(User.id).where(User.team_id == args["team_id"])))
        ids = [i for i in team_members if visible is None or i in visible]
    statuses = tuple(x for x in (args.get("status") or "").split(",") if x) or None
    rows = svc.list_for_users(ids, args["from_"], args["to"], statuses)
    return jsonify([svc.serialize(a, me()) for a in rows])


@bp.route("/absences/pending", methods=["GET"])
@scope_required("absences:read")
def pending():
    """Approval inbox of the signed-in lead/admin."""
    return jsonify([svc.serialize(a, me()) for a in svc.pending_for_approver(me())])


@bp.route("/absences/sick-check", methods=["GET"])
@scope_required("absences:read")
@bp.arguments(s.SickCheckQuery, location="query")
def sick_check(args):
    """Whether the signed-in user may report sick on the given day (default: today)."""
    return jsonify(svc.self_sick_allowed(me(), args.get("date")))


@bp.route("/absences/preview", methods=["GET"])
@scope_required("absences:read")
@bp.arguments(s.AbsencePreviewQuery, location="query")
def preview(args):
    """How many working days a request would use, and the vacation left afterwards."""
    owner = _owner(args.get("user_id"))
    end = args.get("end_date") or args["start_date"]
    if end < args["start_date"] or (end - args["start_date"]).days > 366:
        raise Validation("Invalid date range", fields={"end_date": "invalid"})
    eh = args["end_half"] if end != args["start_date"] else "full"
    days = accounts.count_absence_days(owner, args["start_date"], end, args["start_half"], eh)
    vac = accounts.vacation_account(owner, args["start_date"].year)
    t = svc.get_type(args["type"])
    return jsonify({"days": days, "deducts_vacation": t.deducts_vacation,
                    "vacation_remaining": vac["remaining_after_pending"],
                    "vacation_after": vac["remaining_after_pending"] - (days if t.deducts_vacation else 0)})


@bp.route("/absences/<int:absence_id>", methods=["GET"])
@scope_required("absences:read")
def get_absence(absence_id: int):
    return jsonify(svc.serialize(_visible(absence_id), me()))


@bp.route("/absences/<int:absence_id>/history", methods=["GET"])
@scope_required("absences:read")
def absence_history(absence_id: int):
    a = _visible(absence_id)
    return jsonify([revisions.serialize(r) for r in revisions.history("absence", a.id)])


# --------------------------------------------------------------------------- mutations

@bp.route("/absences", methods=["POST"])
@scope_required("absences:write")
@bp.arguments(s.AbsenceIn)
def create_absence(data):
    """Request vacation / report sick. Leads and admins may record absences for their members."""
    owner = _owner(data.get("user_id"))
    a = svc.create(me(), owner, type_ref=data["type"], start_date=data["start_date"], end_date=data.get("end_date"),
                   start_half=data["start_half"], end_half=data["end_half"], note=data["note"],
                   source=request_source())
    db.session.commit()
    return ok(svc.serialize(a, me()), 201)


@bp.route("/absences/sick-today", methods=["POST"])
@scope_required("absences:write")
@bp.arguments(s.NoteIn)
def sick_today(data):
    """One-click: report the signed-in user sick for today (stops a running clock)."""
    from ..services import entries

    user = me()
    today = local_today(user.timezone)
    a = svc.create(user, user, type_ref="sick", start_date=today, end_date=today, note=data.get("note", ""),
                   source=request_source())
    if entries.open_entry(user) is not None:
        entries.clock_action(user, "stop", source=request_source())
    db.session.commit()
    return ok(svc.serialize(a, me()), 201)


@bp.route("/absences/<int:absence_id>", methods=["PATCH"])
@scope_required("absences:write")
@bp.arguments(s.AbsencePatch)
def patch_absence(data, absence_id: int):
    a = _visible(absence_id)
    reason = data.pop("reason", "")
    svc.update(me(), a, data, reason=reason, source=request_source())
    db.session.commit()
    return jsonify(svc.serialize(a, me()))


@bp.route("/absences/<int:absence_id>/approve", methods=["POST"])
@scope_required("absences:write")
@bp.arguments(s.NoteIn)
def approve(data, absence_id: int):
    a = _visible(absence_id)
    svc.decide(me(), a, True, data.get("note", ""), source=request_source())
    db.session.commit()
    return jsonify(svc.serialize(a, me()))


@bp.route("/absences/<int:absence_id>/reject", methods=["POST"])
@scope_required("absences:write")
@bp.arguments(s.NoteIn)
def reject(data, absence_id: int):
    a = _visible(absence_id)
    svc.decide(me(), a, False, data.get("note", ""), source=request_source())
    db.session.commit()
    return jsonify(svc.serialize(a, me()))


@bp.route("/absences/<int:absence_id>/cancel", methods=["POST"])
@scope_required("absences:write")
@bp.arguments(s.ReasonIn)
def cancel(data, absence_id: int):
    """Cancel a pending or approved absence (leads/admins: reason required)."""
    a = _visible(absence_id)
    svc.cancel(me(), a, data.get("reason", ""), source=request_source())
    db.session.commit()
    return jsonify(svc.serialize(a, me()))


# --------------------------------------------------------------------------- attachments

@bp.route("/absences/<int:absence_id>/attachments", methods=["POST"])
@scope_required("absences:write")
def upload(absence_id: int):
    """Upload a doctor's note / scan (multipart field `file`; PDF, PNG, JPEG, WebP, HEIC)."""
    a = _visible(absence_id)
    f = request.files.get("file")
    if f is None:
        raise Validation("No file uploaded", fields={"file": "required"})
    att = svc.add_attachment(me(), a, f)
    db.session.commit()
    return ok(svc.serialize_attachment(att), 201)


@bp.route("/attachments/<int:attachment_id>", methods=["GET"])
@scope_required("absences:read")
def download(attachment_id: int):
    att, path = svc.get_attachment(me(), attachment_id)
    inline = request.args.get("inline") == "1"
    resp = send_file(path, mimetype=att.content_type, as_attachment=not inline, download_name=att.filename,
                     max_age=0)
    resp.headers["Cache-Control"] = "private, no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
    return resp


@bp.route("/attachments/<int:attachment_id>", methods=["DELETE"])
@scope_required("absences:write")
def delete_attachment(attachment_id: int):
    svc.delete_attachment(me(), attachment_id)
    db.session.commit()
    return ok()


# --------------------------------------------------------------------------- team calendar

def _public_absence(x: dict, full: bool) -> dict:
    """Colleagues see *that* someone is absent; health-related types are anonymized."""
    if full:
        return x
    if x.get("category") == "sick":
        return {"id": None, "type": "absent", "label": "Absent", "color": "#8a8d93", "status": x["status"],
                "halves": x["halves"], "category": "other"}
    return {k: x[k] for k in ("id", "type", "label", "color", "status", "halves", "category")}


@bp.route("/calendar/team", methods=["GET"])
@scope_required("absences:read")
@bp.arguments(s.TeamRangeQuery, location="query")
def team_calendar(args):
    """People x days matrix: absences, holidays and workdays for the visible users."""
    if (args["to"] - args["from_"]).days > 93:
        raise Validation("Range too large (max 3 months)", fields={"to": "too_large"})
    visible = permissions.visible_user_ids(me())
    q = db.select(User).where(User.is_active.is_(True))
    if visible is not None:
        # employees see their own team's calendar (absences only, no notes)
        team_ids = permissions.led_team_ids(me()) | ({me().team_id} if me().team_id else set())
        q = q.where(db.or_(User.id.in_(visible), User.team_id.in_(team_ids)))
    if args.get("team_id"):
        q = q.where(User.team_id == args["team_id"])
    users = list(db.session.scalars(q.order_by(User.name)))
    out = []
    for u in users:
        ctx = accounts.load_context(u, args["from_"], args["to"])
        days = accounts.compute_days(ctx)
        can_see_details = permissions.can_view_user(me(), u)
        out.append({
            "user": {"id": u.id, "name": u.name, "team_id": u.team_id},
            "days": [{"date": d.date, "workday": d.is_workday, "holiday": d.holiday,
                      "absences": [_public_absence(x, can_see_details) for x in d.absences]} for d in days],
        })
    shown = {u.team_id for u in users if u.team_id is not None}
    teams = [{"id": t.id, "name": t.name, "color": t.color}
             for t in db.session.scalars(db.select(Team).where(Team.id.in_(shown)))] if shown else []
    return jsonify({"from": args["from_"].isoformat(), "to": args["to"].isoformat(), "rows": out, "teams": teams})

