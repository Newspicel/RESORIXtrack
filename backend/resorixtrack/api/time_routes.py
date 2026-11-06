# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Clock, time entries, computed days and account statements."""

from __future__ import annotations

from flask import jsonify, request
from flask_smorest import Blueprint

from ..auth import request_source, scope_required
from ..errors import NotFound, Validation
from ..extensions import db
from ..models import BalanceAdjustment, User
from ..services import accounts, entries, permissions, revisions
from ..services import users as users_svc
from ..timeutil import local_today, range_bounds_utc
from . import schemas as s
from .common import aware, me, ok

bp = Blueprint("time", __name__, url_prefix="/api/v1", description="Clock, entries and time accounts")


def _target(user_id: int | None) -> User:
    if user_id is None or user_id == me().id:
        return me()
    return permissions.require_view(me(), user_id)


# --------------------------------------------------------------------------- clock

@bp.route("/clock", methods=["GET"])
@scope_required("clock", "entries:read")
def clock_get():
    """Current clock state of the signed-in user."""
    return jsonify(entries.clock_state(me()))


@bp.route("/clock/<string:action>", methods=["POST"])
@scope_required("clock")
@bp.arguments(s.ClockIn)
def clock_post(data, action: str):
    """Quick entry: `start`, `break`, `resume`, `stop`. Idempotent. Optional `at` (offline sync, or a time chosen by
    hand together with `custom: true`, which marks the entry as manual)."""
    if action not in ("start", "break", "resume", "stop"):
        raise NotFound("Unknown clock action")
    user = me()
    source = "manual" if (data.get("custom") and data.get("at")) else request_source()
    entries.clock_action(user, action, at=aware(data.get("at"), user.timezone), source=source, note=data.get("note") or "")
    db.session.commit()
    return jsonify(entries.clock_state(user))


# --------------------------------------------------------------------------- entries

@bp.route("/entries", methods=["GET"])
@scope_required("entries:read")
@bp.arguments(s.RangeQuery, location="query")
def list_entries(args):
    """Entries overlapping the local date range [from, to] of the user."""
    user = _target(args.get("user_id"))
    start, end = range_bounds_utc(args["from_"], args["to"], user.timezone)
    rows = entries.list_entries(user, start, end, include_deleted=args["include_deleted"])
    ids = [e.id for e in rows]
    edited = entries.edited_entry_ids(ids)
    corrected = entries.corrected_entry_ids(ids, user.id)
    out = []
    for e in rows:
        item = entries.serialize(e, edited)
        item["corrected"] = e.id in corrected
        item["deleted"] = e.is_deleted
        out.append(item)
    return jsonify(out)


@bp.route("/entries", methods=["POST"])
@scope_required("entries:write")
@bp.arguments(s.EntryIn)
def create_entry(data):
    """Manual entry (e.g. forgot to clock in). Leads/admins may pass `user_id`; a reason is required then."""
    owner = _target(data.get("user_id"))
    e = entries.create_entry(me(), owner, kind=data["kind"],
                             start_at=aware(data["start_at"], owner.timezone),
                             end_at=aware(data["end_at"], owner.timezone), note=data["note"],
                             reason=data["reason"], source="manual" if request_source() == "web" else request_source())
    db.session.commit()
    return ok(entries.serialize(e), 201)


def _visible_entry(entry_id: int):
    e = entries.get_entry(entry_id)
    owner = db.session.get(User, e.user_id)
    if not permissions.can_view_user(me(), owner):
        raise NotFound("Entry not found")
    return e, owner


@bp.route("/entries/<int:entry_id>", methods=["GET"])
@scope_required("entries:read")
def get_entry(entry_id: int):
    e, _ = _visible_entry(entry_id)
    return jsonify(entries.serialize(e, entries.edited_entry_ids([e.id])))


@bp.route("/entries/<int:entry_id>", methods=["PATCH"])
@scope_required("entries:write")
@bp.arguments(s.EntryPatch)
def patch_entry(data, entry_id: int):
    e, owner = _visible_entry(entry_id)
    changes = {}
    for k in ("start_at", "end_at"):
        if k in data:
            changes[k] = aware(data[k], owner.timezone)
    for k in ("kind", "note"):
        if k in data:
            changes[k] = data[k]
    entries.update_entry(me(), e, changes, reason=data.get("reason", ""), source=request_source())
    db.session.commit()
    return jsonify(entries.serialize(e, entries.edited_entry_ids([e.id])))


@bp.route("/entries/<int:entry_id>", methods=["DELETE"])
@scope_required("entries:write")
def delete_entry(entry_id: int):
    """Soft delete; the entry stays in the change history. Reason via JSON body or `?reason=`."""
    e, _ = _visible_entry(entry_id)
    body = request.get_json(silent=True) or {}
    reason = str(body.get("reason") or request.args.get("reason") or "")[:500]
    entries.delete_entry(me(), e, reason=reason, source=request_source())
    db.session.commit()
    return ok()


@bp.route("/entries/<int:entry_id>/history", methods=["GET"])
@scope_required("entries:read")
def entry_history(entry_id: int):
    """Full change log of an entry (who, when, before/after, reason)."""
    e, _ = _visible_entry(entry_id)
    return jsonify([revisions.serialize(r) for r in revisions.history("time_entry", e.id)])


@bp.route("/entries/<int:entry_id>/dispute", methods=["POST"])
@scope_required("entries:write")
@bp.arguments(s.DisputeIn)
def dispute_entry(data, entry_id: int):
    e, _ = _visible_entry(entry_id)
    entries.dispute(me(), e, data["message"])
    db.session.commit()
    return ok()


# --------------------------------------------------------------------------- computed days

@bp.route("/days", methods=["GET"])
@scope_required("entries:read")
@bp.arguments(s.RangeQuery, location="query")
def days(args):
    """Per-day target / worked / delta with holidays and absences, plus a summary."""
    user = _target(args.get("user_id"))
    ctx = accounts.load_context(user, args["from_"], args["to"])
    edited = entries.edited_entry_ids([e.id for e in ctx.entries])
    result = accounts.compute_days(ctx, edited_entry_ids=edited)
    from ..services import signoffs

    return jsonify({"user_id": user.id, "timezone": user.timezone, "days": [d.as_dict() for d in result],
                    "summary": accounts.summarize(result),
                    "locked_months": signoffs.locked_months(user, args["from_"], args["to"])})


# --------------------------------------------------------------------------- accounts

@bp.route("/accounts/<int:user_id>/balance", methods=["GET"])
@scope_required("entries:read", "reports:read")
def balance(user_id: int):
    user = _target(user_id)
    today = local_today(user.timezone)
    return jsonify({"time": accounts.time_balance(user), "vacation": accounts.vacation_account(user, today.year)})


@bp.route("/accounts/<int:user_id>/time", methods=["GET"])
@scope_required("entries:read", "reports:read")
@bp.arguments(s.YearQuery, location="query")
def time_statement(args, user_id: int):
    """Time account statement for a year: opening, months, adjustments, closing."""
    user = _target(user_id)
    year = args.get("year") or local_today(user.timezone).year
    return jsonify(accounts.time_statement(user, year))


@bp.route("/accounts/<int:user_id>/vacation", methods=["GET"])
@scope_required("entries:read", "reports:read")
@bp.arguments(s.YearQuery, location="query")
def vacation_statement(args, user_id: int):
    user = _target(user_id)
    year = args.get("year") or local_today(user.timezone).year
    return jsonify(accounts.vacation_account(user, year))


@bp.route("/accounts/<int:user_id>/adjustments", methods=["POST"])
@scope_required("admin", "entries:write")
@bp.arguments(s.AdjustmentIn)
def add_adjustment(data, user_id: int):
    """Opening balance, payout or correction (logged; reason required)."""
    user = _target(user_id)
    adj = users_svc.add_adjustment(me(), user, data)
    db.session.commit()
    return ok(accounts.serialize_adjustment(adj), 201)


@bp.route("/adjustments/<int:adj_id>", methods=["DELETE"])
@scope_required("admin", "entries:write")
def delete_adjustment(adj_id: int):
    adj = db.session.get(BalanceAdjustment, adj_id)
    if adj is None or adj.is_deleted:
        raise NotFound("Adjustment not found")
    _target(adj.user_id)
    body = request.get_json(silent=True) or {}
    users_svc.delete_adjustment(me(), adj, str(body.get("reason") or request.args.get("reason") or ""))
    db.session.commit()
    return ok()


@bp.route("/accounts/<int:user_id>/entitlements/<int:year>", methods=["PUT"])
@scope_required("admin", "entries:write")
@bp.arguments(s.EntitlementIn)
def put_entitlement(data, user_id: int, year: int):
    """Override vacation days for one year (`days: null` removes the override)."""
    user = _target(user_id)
    if not 1990 <= year <= 2100:
        raise Validation("Invalid year")
    users_svc.set_entitlement(me(), user, year, data["days"], data.get("note", ""))
    db.session.commit()
    return jsonify(accounts.vacation_account(user, year))


@bp.route("/users/<int:user_id>/history", methods=["GET"])
@scope_required("entries:read")
def user_history(user_id: int):
    """Recent changes affecting a user (entries, absences, adjustments, schedules)."""
    user = _target(user_id)
    from ..models import Revision

    rows = db.session.scalars(db.select(Revision).where(Revision.subject_user_id == user.id)
                              .order_by(Revision.at.desc(), Revision.id.desc()).limit(200))
    return jsonify([revisions.serialize(r) for r in rows])
