# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Work log: what a person did while clocked in, per day – free text and/or a project.

Projects are managed by team leads (for their teams) and administrators (company-wide or any team).
The company decides whether the work log is off, optional or required; "required" means that at
least ``worklog_required_percent`` of the worked minutes of every day must be annotated, which is
shown as a warning in the UI and blocks the month sign-off.
"""

from __future__ import annotations

from datetime import date, time, timedelta
from typing import Any

from ..errors import Conflict, Forbidden, NotFound, Validation
from ..extensions import db
from ..models import Project, Team, User, WorkLog
from ..timeutil import iso, local_today
from . import permissions, revisions
from . import settings as settings_svc

MODES = ("off", "optional", "required")


def config() -> dict[str, Any]:
    st = settings_svc.get_all()
    return {"mode": st["worklog_mode"], "percent": int(st["worklog_required_percent"]),
            "project_required": bool(st["worklog_project_required"])}


# --------------------------------------------------------------------------- projects

def serialize_project(p: Project) -> dict[str, Any]:
    return {"id": p.id, "name": p.name, "code": p.code, "color": p.color, "description": p.description,
            "team_id": p.team_id, "team_name": p.team.name if p.team else None, "is_active": p.is_active,
            "created_at": iso(p.created_at)}


def visible_projects(actor: User, include_inactive: bool = False) -> list[Project]:
    """Projects a person may book time on: company-wide ones plus those of their own team.
    Leads additionally see the projects of the teams they lead; administrators see all."""
    q = db.select(Project)
    if not (actor.has_cap("projects") or actor.is_hr):
        teams = permissions.led_team_ids(actor) | ({actor.team_id} if actor.team_id else set())
        q = q.where(db.or_(Project.team_id.is_(None), Project.team_id.in_(teams)))
    if not include_inactive:
        q = q.where(Project.is_active.is_(True))
    return list(db.session.scalars(q.order_by(Project.is_active.desc(), Project.name)))


def can_manage_project(actor: User, team_id: int | None) -> bool:
    return permissions.can_manage_projects(actor, team_id)


def save_project(actor: User, data: dict[str, Any], project: Project | None = None) -> Project:
    team_id = data.get("team_id", project.team_id if project else None)
    if not can_manage_project(actor, team_id) or (project and not can_manage_project(actor, project.team_id)):
        raise Forbidden("Team leads manage the projects of their own teams; company-wide projects need the "
                        "'projects' capability")
    if team_id is not None and db.session.get(Team, team_id) is None:
        raise Validation("Unknown team", fields={"team_id": "invalid"})
    name = (data.get("name") or (project.name if project else "")).strip()
    if not name:
        raise Validation("Project name is required", fields={"name": "required"})
    clash = db.session.scalar(db.select(Project.id).where(Project.name == name))
    if clash and (project is None or clash != project.id):
        raise Conflict("A project with this name already exists", code="project_taken", fields={"name": "taken"})
    if project is None:
        project = Project(name=name, created_by_id=actor.id)
        db.session.add(project)
    before = revisions.snapshot(project) if project.id else None
    project.name = name[:120]
    project.team_id = team_id
    for key in ("code", "color", "description", "is_active"):
        if key in data and data[key] is not None:
            setattr(project, key, data[key].strip()[:30] if key == "code" else data[key])
    db.session.flush()
    revisions.record(obj=project, action="update" if before else "create", actor=actor, subject_user_id=None,
                     before=before)
    return project


def get_project_or_404(project_id: int) -> Project:
    p = db.session.get(Project, project_id)
    if p is None:
        raise NotFound("Project not found")
    return p


# --------------------------------------------------------------------------- work log items

def serialize(w: WorkLog) -> dict[str, Any]:
    return {"id": w.id, "user_id": w.user_id, "date": w.date.isoformat(), "minutes": w.minutes, "note": w.note,
            "start_time": w.start_time.strftime("%H:%M") if w.start_time else None,
            "end_time": w.end_time.strftime("%H:%M") if w.end_time else None, "customer_ref": w.customer_ref,
            "project": serialize_project(w.project) if w.project else None, "project_id": w.project_id,
            "created_by_id": w.created_by_id, "created_at": iso(w.created_at), "updated_at": iso(w.updated_at),
            "is_deleted": w.is_deleted}


def list_logs(user: User, start: date, end: date, include_deleted: bool = False) -> list[WorkLog]:
    q = db.select(WorkLog).where(WorkLog.user_id == user.id, WorkLog.date >= start, WorkLog.date <= end)
    if not include_deleted:
        q = q.where(WorkLog.is_deleted.is_(False))
    return list(db.session.scalars(q.order_by(WorkLog.date, WorkLog.id)))


def minutes_by_date(user: User, start: date, end: date) -> dict[date, int]:
    out: dict[date, int] = {}
    for w in list_logs(user, start, end):
        out[w.date] = out.get(w.date, 0) + int(w.minutes)
    return out


def required_minutes(worked_min: float, cfg: dict[str, Any] | None = None) -> int:
    """How many annotated minutes a day with ``worked_min`` needs; 0 when the log is not required."""
    cfg = cfg or config()
    if cfg["mode"] != "required" or worked_min <= 0:
        return 0
    return int(-(-worked_min * cfg["percent"] // 100))  # ceil


def _check_access(actor: User, owner: User) -> None:
    if actor.id != owner.id and not permissions.can_manage_user(actor, owner):
        raise Forbidden("You can only log work for yourself or for members of teams you lead")


def _validate(actor: User, owner: User, data: dict[str, Any], existing: WorkLog | None = None) -> Project | None:
    cfg = config()
    if cfg["mode"] == "off":
        raise Conflict("The work log is switched off for this company", code="worklog_off")
    d = data.get("date", existing.date if existing else None)
    if d is None:
        raise Validation("Date is required", fields={"date": "required"})
    if d > local_today(owner.timezone):
        raise Validation("The date is in the future", fields={"date": "future"})
    if owner.employment_start and d < owner.employment_start:
        raise Validation("Before the employment start", fields={"date": "not_employed"})
    start = data.get("start_time", existing.start_time if existing else None)
    end = data.get("end_time", existing.end_time if existing else None)
    if (start is None) != (end is None):
        raise Validation("Give both a start and an end time, or neither", fields={"end_time" if end is None else "start_time": "required"})
    if start is not None:
        start, end = start.replace(second=0, microsecond=0), end.replace(second=0, microsecond=0)
        derived = _minutes_between(start, end)
        if derived <= 0:
            raise Validation("The end must be after the start", fields={"end_time": "before_start"})
        if data.get("minutes") not in (None, derived):
            raise Validation("The duration follows from the times; clear them to enter a duration", fields={"minutes": "derived"})
        for other in _timed_items(owner, d, exclude_id=existing.id if existing else None):
            if start < other.end_time and other.start_time < end:
                raise Conflict("Overlaps another item of this day", code="worklog_overlap",
                               fields={"start_time": "overlap", "end_time": "overlap"})
        data["minutes"], data["start_time"], data["end_time"] = derived, start, end
    else:
        minutes = data.get("minutes", existing.minutes if existing else None)
        if minutes is None or not (1 <= int(minutes) <= 24 * 60):
            raise Validation("Duration must be between 1 minute and 24 hours", fields={"minutes": "invalid"})
        data["minutes"] = int(minutes)
        if existing is not None and (existing.start_time or existing.end_time) and ("start_time" in data or "end_time" in data):
            data["start_time"] = data["end_time"] = None
    project = None
    project_id = data.get("project_id", existing.project_id if existing else None)
    customer_ref = (data.get("customer_ref", existing.customer_ref if existing else "") or "").strip()[:60]
    data["customer_ref"] = customer_ref
    if project_id is not None and customer_ref:
        raise Validation("Choose a project or a customer reference, not both", fields={"customer_ref": "invalid"})
    if project_id is not None:
        project = get_project_or_404(project_id)
        if project not in visible_projects(owner, include_inactive=True) and not (actor.is_hr or actor.has_cap("projects")):
            raise Validation("This project is not available for this person", fields={"project_id": "invalid"})
        if not project.is_active and (existing is None or existing.project_id != project.id):
            raise Validation("This project is no longer active", fields={"project_id": "inactive"})
    elif cfg["project_required"] and not customer_ref:
        raise Validation("A project or a customer reference is required", fields={"project_id": "required"})
    note = (data.get("note", existing.note if existing else "") or "").strip()
    if not note and project is None and not customer_ref:
        raise Validation("Describe what you did, or choose a project or a customer reference", fields={"note": "required"})
    return project


def _minutes_between(start: time, end: time) -> int:
    return (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)


def _timed_items(owner: User, d: date, exclude_id: int | None) -> list[WorkLog]:
    q = db.select(WorkLog).where(WorkLog.user_id == owner.id, WorkLog.date == d, WorkLog.is_deleted.is_(False),
                                 WorkLog.start_time.is_not(None))
    if exclude_id is not None:
        q = q.where(WorkLog.id != exclude_id)
    return list(db.session.scalars(q))


def add_log(actor: User, owner: User, data: dict[str, Any], source: str = "web") -> WorkLog:
    from . import signoffs

    _check_access(actor, owner)
    project = _validate(actor, owner, data)
    signoffs.ensure_open_dates(owner, data["date"])
    w = WorkLog(user_id=owner.id, date=data["date"], project_id=project.id if project else None,
                minutes=int(data["minutes"]), start_time=data.get("start_time"), end_time=data.get("end_time"),
                customer_ref=data["customer_ref"], note=(data.get("note") or "").strip()[:2000], created_by_id=actor.id)
    db.session.add(w)
    db.session.flush()
    revisions.record(obj=w, action="create", actor=actor, subject_user_id=owner.id, before=None,
                     reason=data.get("reason", ""), source=source)
    return w


def update_log(actor: User, w: WorkLog, data: dict[str, Any], reason: str = "", source: str = "web") -> WorkLog:
    from . import signoffs

    owner = db.session.get(User, w.user_id)
    _check_access(actor, owner)
    if w.is_deleted:
        raise Conflict("This item was deleted", code="deleted")
    project = _validate(actor, owner, data, existing=w)
    new_date = data.get("date", w.date)
    signoffs.ensure_open_dates(owner, min(w.date, new_date), max(w.date, new_date))
    before = revisions.snapshot(w)
    w.date = new_date
    w.minutes = int(data["minutes"])
    if "start_time" in data or "end_time" in data:
        w.start_time, w.end_time = data.get("start_time"), data.get("end_time")
    if "project_id" in data:
        w.project_id = project.id if project else None
    w.customer_ref = data["customer_ref"]
    if "note" in data:
        w.note = (data["note"] or "").strip()[:2000]
    if revisions.snapshot(w) != before:
        revisions.record(obj=w, action="update", actor=actor, subject_user_id=owner.id, before=before,
                         reason=reason, source=source)
    return w


def delete_log(actor: User, w: WorkLog, reason: str = "", source: str = "web") -> None:
    from . import signoffs

    owner = db.session.get(User, w.user_id)
    _check_access(actor, owner)
    if w.is_deleted:
        return
    signoffs.ensure_open_dates(owner, w.date)
    before = revisions.snapshot(w)
    w.is_deleted = True
    revisions.record(obj=w, action="delete", actor=actor, subject_user_id=owner.id, before=before,
                     reason=reason, source=source)


def recent_customer_refs(user: User, limit: int = 50) -> list[str]:
    """Customer references the person used in the last year, most recent first (for suggestions)."""
    since = local_today(user.timezone) - timedelta(days=365)
    rows = db.session.execute(db.select(WorkLog.customer_ref, db.func.max(WorkLog.date).label("last"),
                                        db.func.max(WorkLog.id).label("last_id")).where(
        WorkLog.user_id == user.id, WorkLog.is_deleted.is_(False), WorkLog.customer_ref != "", WorkLog.date >= since)
        .group_by(WorkLog.customer_ref).order_by(db.desc("last"), db.desc("last_id")).limit(limit))
    return [r[0] for r in rows]


def get_log_or_404(log_id: int) -> WorkLog:
    w = db.session.get(WorkLog, log_id)
    if w is None:
        raise NotFound("Work log item not found")
    return w


# --------------------------------------------------------------------------- reports

def project_report(users: list[User], start: date, end: date) -> dict[str, Any]:
    """Minutes per project and person in the period (deleted items excluded)."""
    ids = [u.id for u in users]
    rows = db.session.scalars(db.select(WorkLog).where(WorkLog.user_id.in_(ids), WorkLog.date >= start,
                                                        WorkLog.date <= end, WorkLog.is_deleted.is_(False)))
    by_project: dict[Any, dict[str, Any]] = {}
    by_person: dict[int, dict[str, Any]] = {u.id: {"user_id": u.id, "name": u.name, "team": u.team.name if u.team else None,
                                                   "minutes": 0, "items": 0, "by_project": {}} for u in users}
    for w in rows:
        key: Any = ("customer", w.customer_ref) if w.customer_ref else w.project_id
        p = by_project.setdefault(key, {"project_id": w.project_id, "customer_ref": w.customer_ref,
                                        "kind": "customer" if w.customer_ref else ("project" if w.project else "none"),
                                        "name": w.customer_ref or (w.project.name if w.project else None),
                                        "code": w.project.code if w.project else "", "color": w.project.color if w.project else "",
                                        "team": w.project.team.name if (w.project and w.project.team) else None,
                                        "minutes": 0, "items": 0, "people": {}})
        p["minutes"] += w.minutes
        p["items"] += 1
        p["people"][w.user_id] = p["people"].get(w.user_id, 0) + w.minutes
        person = by_person[w.user_id]
        person["minutes"] += w.minutes
        person["items"] += 1
        label = w.customer_ref or (w.project.name if w.project else None)
        person["by_project"][label or ""] = person["by_project"].get(label or "", 0) + w.minutes
    projects = sorted(by_project.values(), key=lambda p: (-p["minutes"], p["name"] or "~"))
    for p in projects:
        p["people"] = [{"user_id": uid, "name": by_person[uid]["name"], "minutes": m} for uid, m in
                       sorted(p["people"].items(), key=lambda kv: -kv[1])]
    return {"report": "projects", "start": start.isoformat(), "end": end.isoformat(), "projects": projects,
            "people": sorted(by_person.values(), key=lambda r: r["name"]),
            "total_min": sum(p["minutes"] for p in projects), "company": settings_svc.get("company_name")}


def days_with_gaps(user: User, start: date, end: date) -> list[date]:
    """Days in the period whose annotated minutes are below the required share (empty unless required)."""
    from . import accounts

    cfg = config()
    if cfg["mode"] != "required":
        return []
    ctx = accounts.load_context(user, start, end, include_pending=False)
    today = local_today(user.timezone)
    out = []
    for day in accounts.compute_days(ctx):
        d = date.fromisoformat(day.date)
        if d >= today or day.worked_min <= 0:
            continue
        if day.worklog_min < required_minutes(day.worked_min, cfg):
            out.append(d)
    return out


def first_missing_day(user: User, days_back: int = 14) -> date | None:
    today = local_today(user.timezone)
    gaps = days_with_gaps(user, today - timedelta(days=days_back), today - timedelta(days=1))
    return gaps[0] if gaps else None
