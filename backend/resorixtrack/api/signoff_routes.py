# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Monthly sign-off of timesheets (team leads / administrators)."""

from __future__ import annotations

from flask import jsonify
from flask_smorest import Blueprint

from ..auth import login_required, scope_required
from ..errors import ApiError, Forbidden, NotFound
from ..extensions import db
from ..models import MonthSignoff, User
from ..services import accounts, permissions
from ..services import signoffs as svc
from ..timeutil import month_bounds
from . import schemas as s
from .common import me, ok

bp = Blueprint("signoffs", __name__, url_prefix="/api/v1/signoffs", description="Monthly sign-off (locks months)")


def _scope_users(team_id: int | None, period_start=None) -> list[User]:
    """Active users plus leavers whose employment reached into the month (their last month can
    still be signed off after deactivation)."""
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
    return list(db.session.scalars(q.order_by(User.name)))


@bp.route("", methods=["GET"])
@scope_required("entries:read", "reports:read")
@bp.arguments(s.SignoffQuery, location="query")
def list_signoffs(args):
    """Sign-offs visible to the caller (own; team members for leads; all for admins)."""
    visible = permissions.visible_user_ids(me())
    q = db.select(MonthSignoff)
    if visible is not None:
        q = q.where(MonthSignoff.user_id.in_(visible))
    if args.get("user_id"):
        permissions.require_view(me(), args["user_id"])
        q = q.where(MonthSignoff.user_id == args["user_id"])
    if args.get("month"):
        q = q.where(MonthSignoff.month == args["month"])
    rows = list(db.session.scalars(q.order_by(MonthSignoff.month.desc(), MonthSignoff.id.desc()).limit(500)))
    return jsonify([svc.serialize(r) for r in rows])


@bp.route("/overview", methods=["GET"])
@login_required
@bp.arguments(s.SignoffQuery, location="query")
def overview(args):
    """For leads/admins: each person's month figures, sign-off status and blockers."""
    if not permissions.is_manager(me()):
        raise Forbidden("Only team leads and administrators can sign off months")
    month = args.get("month") or svc.previous_month(me())
    year, mon = svc.parse_month(month)
    start, end = month_bounds(year, mon)
    out = []
    for u in _scope_users(args.get("team_id"), period_start=start):
        if u.employment_start and u.employment_start > end:
            continue
        active = db.session.scalar(db.select(MonthSignoff).where(
            MonthSignoff.user_id == u.id, MonthSignoff.month == month, MonthSignoff.reopened_at.is_(None)))
        summary = accounts.summarize(accounts.compute_days(accounts.load_context(u, start, end, include_pending=False)))
        out.append({
            "user": {"id": u.id, "name": u.name, "team_id": u.team_id, "team_name": u.team.name if u.team else None},
            "summary": summary, "signoff": svc.serialize(active) if active else None,
            "blockers": [b for b in svc.blockers(u, month) if b != "already_signed"],
            "can_sign": svc.can_sign(me(), u) and active is None,
        })
    return jsonify({"month": month, "rows": out})


@bp.route("", methods=["POST"])
@login_required
@bp.arguments(s.SignoffIn)
def sign(data):
    """Sign off a month for one or more people. Signed months can no longer be changed."""
    results = []
    for uid in sorted(set(data["user_ids"])):
        target = db.session.get(User, uid)
        if target is None or not permissions.can_view_user(me(), target):
            results.append({"user_id": uid, "ok": False, "error": {"code": "not_found", "message": "User not found"}})
            continue
        try:
            row = svc.sign_off(me(), target, data["month"], data.get("note", ""))
            db.session.commit()
            results.append({"user_id": uid, "ok": True, "signoff": svc.serialize(row)})
        except ApiError as e:
            db.session.rollback()
            results.append({"user_id": uid, "ok": False, "error": {"code": e.code, "message": e.message}})
    status = 201 if any(r["ok"] for r in results) else 409
    return ok({"results": results}, status)


@bp.route("/<int:signoff_id>/reopen", methods=["POST"])
@login_required
@bp.arguments(s.ReasonIn)
def reopen(data, signoff_id: int):
    """Administrators only: reopen a signed-off month (reason required, logged, people notified)."""
    row = svc.get(signoff_id)
    svc.reopen(me(), row, data.get("reason", ""))
    db.session.commit()
    return jsonify(svc.serialize(row))


@bp.route("/verify", methods=["GET"])
@login_required
@bp.arguments(s.SignoffQuery, location="query")
def verify(args):
    """Integrity check of all sign-offs: seals, chain and data fingerprints."""
    q = db.select(MonthSignoff.user_id).distinct()
    if args.get("user_id"):
        q = q.where(MonthSignoff.user_id == args["user_id"])
    out = []
    counts = {"intact": 0, "data_changed": 0, "seal_invalid": 0, "chain_broken": 0}
    for (uid,) in db.session.execute(q):
        statuses = svc.verify_user(uid)
        for sid, st in statuses.items():
            counts[st] += 1
            if st != "intact":
                out.append(svc.serialize(db.session.get(MonthSignoff, sid), st))
    from ..db_guards import TRIGGERS, installed

    with db.engine.connect() as conn:
        present = installed(conn)
    missing = [n for n, _ in TRIGGERS if n not in present]
    return jsonify({"counts": counts, "problems": out, "guards": {"expected": len(TRIGGERS), "missing": missing},
                    "ok": len(out) == 0 and not missing})


@bp.route("/<int:signoff_id>", methods=["GET"])
@scope_required("entries:read", "reports:read")
def get_one(signoff_id: int):
    row = svc.get(signoff_id)
    if not permissions.can_view_user(me(), db.session.get(User, row.user_id)):
        raise NotFound("Sign-off not found")
    status = svc.verify_user(row.user_id).get(row.id) if (me().is_admin or me().is_hr) else None
    return jsonify(svc.serialize(row, status))
