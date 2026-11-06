# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Demo data for local development: teams, people, ~3 months of realistic entries."""

from __future__ import annotations

import random
from collections.abc import Iterator
from datetime import date, datetime, time, timedelta

from .extensions import db
from .models import Absence, AbsenceType, Project, Team, TeamLead, TimeEntry, User, WorkLog
from .services import absences, presets, revisions, users
from .services import settings as settings_svc
from .timeutil import local_today, zone

PEOPLE = [
    # name, email, team, role, lead?, pensum, locale
    ("RESORIXtrack Admin", "admin@example.nomail", None, "admin", False, 100, "de"),
    ("Luca Bianchi", "luca.bianchi@example.nomail", "RF Engineering", "employee", True, 100, "en"),
    ("Anna Meier", "anna.meier@example.nomail", "RF Engineering", "employee", False, 100, "de"),
    ("Marc Dubois", "marc.dubois@example.nomail", "RF Engineering", "employee", False, 80, "en"),
    ("Sofia Rossi", "sofia.rossi@example.nomail", "RF Engineering", "employee", False, 100, "en"),
    ("Jonas Keller", "jonas.keller@example.nomail", "Software & DSP", "employee", True, 100, "de"),
    ("Lea Schneider", "lea.schneider@example.nomail", "Software & DSP", "employee", False, 100, "de"),
    ("Noah Favre", "noah.favre@example.nomail", "Software & DSP", "employee", False, 60, "en"),
    ("Mia Brunner", "mia.brunner@example.nomail", "Software & DSP", "employee", False, 100, "en"),
    ("Elena Kovac", "elena.kovac@example.nomail", "Operations", "employee", False, 100, "en"),
    ("Tim Baumann", "tim.baumann@example.nomail", "Operations", "employee", False, 100, "de"),
]
TEAM_COLORS = {"RF Engineering": "#35a1cc", "Software & DSP": "#8f7ad1", "Operations": "#e0a23b"}
PROJECTS = [
    # name, code, team (None = company-wide), color
    ("Internal & administration", "INT", None, "#62656b"),
    ("Training", "TRN", None, "#3fb37f"),
    ("Antenna tuner v2", "AT2", "RF Engineering", "#35a1cc"),
    ("EMC lab", "EMC", "RF Engineering", "#e0a23b"),
    ("DSP firmware", "DSP", "Software & DSP", "#8f7ad1"),
    ("Customer portal", "WEB", "Software & DSP", "#d52b1e"),
]
WORK_NOTES = ["Code review and bug fixes", "Measurements and test report", "Customer call and follow-up",
              "Documentation", "Planning meeting", "Prototype assembly", "Firmware debugging", "Release preparation"]


def _at(d: date, hh: int, mm: int, tz: str) -> datetime:
    return datetime.combine(d, time(hh, mm), tzinfo=zone(tz))


def seed(password: str) -> Iterator[str]:
    rnd = random.Random(42)  # noqa: S311 - demo data
    absences.seed_types()
    cal = presets.install_preset("ch-fr-fribourg", make_default=True)
    settings_svc.update({"setup_complete": True})
    yield f"Holiday calendar: {cal.name}"

    teams = {}
    for name, color in TEAM_COLORS.items():
        existing = db.session.scalar(db.select(Team).where(Team.name == name))
        teams[name] = existing or users.save_team(None, {"name": name, "color": color})  # type: ignore[arg-type]
    db.session.flush()

    created: list[User] = []
    today = local_today("Europe/Zurich")
    start = (today - timedelta(days=95)).replace(day=1)  # demo history starts here (= employment start)
    for name, email, team, role, lead, pensum, locale in PEOPLE:
        u = db.session.scalar(db.select(User).where(User.email == email))
        workdays = round(5 * pensum / 100)  # part-timers work fewer full days (e.g. 80 % = Mon-Thu)
        minutes = {w: (504 if i < workdays else 0) for i, w in enumerate(("mon", "tue", "wed", "thu", "fri", "sat", "sun"))}
        if u is None:
            u = users.create_user(None, {
                "schedule_minutes": minutes,
                "email": email, "name": name, "role": role, "team_id": teams[team].id if team else None,
                "pensum_percent": pensum, "employment_start": start, "locale": locale,
                "vacation_days_per_year": 25.0,
            }, password=password, send_invite=False)
            created.append(u)
        if lead and team and not any(r.user_id == u.id for r in teams[team].lead_rows):
            db.session.add(TeamLead(team_id=teams[team].id, user_id=u.id, role="lead"))
        if role == "admin" and not u.capabilities:
            u.capabilities = ["hr", "projects"]  # the demo administrator also does HR
    db.session.flush()
    # A deputy for two weeks while the RF lead is away (starting today)
    rf = teams["RF Engineering"]
    sofia = db.session.scalar(db.select(User).where(User.email == "sofia.rossi@example.nomail"))
    if sofia and not any(r.user_id == sofia.id for r in rf.lead_rows):
        db.session.add(TeamLead(team_id=rf.id, user_id=sofia.id, role="deputy", valid_from=today,
                                valid_to=today + timedelta(days=14)))
    db.session.flush()
    skipped = len(PEOPLE) - len(created)
    yield f"Users: {len(created)} created" + (f", {skipped} already present (use 'make reset' for a fresh database)" if skipped else "") + f" (password: {password})"

    projects: dict[str | None, list[Project]] = {}
    for pname, code, team, color in PROJECTS:
        p = db.session.scalar(db.select(Project).where(Project.name == pname))
        if p is None:
            p = Project(name=pname, code=code, color=color, team_id=teams[team].id if team else None, is_active=True)
            db.session.add(p)
        projects.setdefault(team, []).append(p)
    db.session.flush()
    yield f"Projects: {sum(len(v) for v in projects.values())}"

    vacation = db.session.scalar(db.select(AbsenceType).where(AbsenceType.key == "vacation"))
    sick = db.session.scalar(db.select(AbsenceType).where(AbsenceType.key == "sick"))
    for u in created:
        tz = u.timezone
        # A week of vacation in the past, one planned, one pending
        v1 = start + timedelta(days=rnd.randint(20, 40))
        v1 -= timedelta(days=v1.weekday())
        for (s, e, status) in ((v1, v1 + timedelta(days=4), "approved"),
                               (today + timedelta(days=rnd.randint(20, 60)), None, "approved"),
                               (today + timedelta(days=rnd.randint(70, 120)), None, "pending")):
            s -= timedelta(days=s.weekday())
            e = e or s + timedelta(days=rnd.choice([2, 4]))
            a = Absence(user_id=u.id, type_id=vacation.id, start_date=s, end_date=e, status=status,
                        requested_by_id=u.id, decided_by_id=None)
            db.session.add(a)
            revisions.record(obj=a, action="create", actor=u, subject_user_id=u.id, before=None)
            if status == "approved":
                team_rows = teams[next(p[2] for p in PEOPLE if p[1] == u.email)].lead_rows if u.team_id else []
                lead_ids = [r.user_id for r in team_rows if r.role == "lead" and r.user_id != u.id]
                approver = db.session.get(User, lead_ids[0]) if lead_ids else None
                a.decided_by_id = approver.id if approver else None
                revisions.record(obj=a, action="approve", actor=approver, subject_user_id=u.id, before=None)
        if rnd.random() < 0.5:
            sd = start + timedelta(days=rnd.randint(5, 80))
            if sd.weekday() < 5:
                a = Absence(user_id=u.id, type_id=sick.id, start_date=sd, end_date=sd,
                            status="approved", requested_by_id=u.id, note="Flu")
                db.session.add(a)
                revisions.record(obj=a, action="create", actor=u, subject_user_id=u.id, before=None)
        db.session.flush()
        absent = {d for a in db.session.scalars(db.select(Absence).where(
            Absence.user_id == u.id, Absence.status == "approved"))
            for d in (a.start_date + timedelta(days=i) for i in range((a.end_date - a.start_date).days + 1))}
        holidays = {h.date for h in cal.holidays}
        sched = u.schedules[0]
        d = start
        while d < today:
            if sched.minutes_for(d) > 0 and d not in absent and d not in holidays:
                sh, sm = rnd.choice([(7, 30), (7, 45), (8, 0), (8, 0), (8, 15), (8, 30)])
                morning = rnd.randint(200, 260)
                brk = rnd.choice([30, 40, 45, 60])
                daily = int(sched.minutes_for(d)) + rnd.randint(-30, 45)
                s1 = _at(d, sh, sm, tz)
                e1 = s1 + timedelta(minutes=morning)
                s2 = e1 + timedelta(minutes=brk)
                e2 = s2 + timedelta(minutes=max(60, daily - morning))
                for (a, b, kind) in ((s1, e1, "work"), (e1, s2, "break"), (s2, e2, "work")):
                    db.session.add(TimeEntry(user_id=u.id, kind=kind, start_at=a, end_at=b, tz=tz,
                                             source="clock", created_by_id=u.id))
                # Work log: most days are annotated (two items), some only partially, a few not at all.
                team_name = next(p[2] for p in PEOPLE if p[1] == u.email)
                pool = projects.get(None, []) + projects.get(team_name, [])
                worked = morning + max(60, daily - morning)
                roll = rnd.random()
                if roll < 0.7 and pool:
                    first = rnd.randint(int(worked * 0.5), int(worked * 0.7))
                    db.session.add(WorkLog(user_id=u.id, date=d, project_id=rnd.choice(pool).id, minutes=first,
                                           note=rnd.choice(WORK_NOTES), created_by_id=u.id))
                    db.session.add(WorkLog(user_id=u.id, date=d, project_id=rnd.choice(pool).id, minutes=worked - first,
                                           note=rnd.choice(WORK_NOTES), created_by_id=u.id))
                elif roll < 0.85 and pool:
                    db.session.add(WorkLog(user_id=u.id, date=d, project_id=rnd.choice(pool).id,
                                           minutes=int(worked * 0.4), note=rnd.choice(WORK_NOTES), created_by_id=u.id))
            d += timedelta(days=1)
        db.session.flush()
    # A correction by a lead, so the change log has content.
    lead = next((r.user for r in teams["RF Engineering"].lead_rows if r.role == "lead"), None)
    anna = db.session.scalar(db.select(User).where(User.email == "anna.meier@example.nomail"))
    if lead and anna:
        e = db.session.scalars(db.select(TimeEntry).where(TimeEntry.user_id == anna.id, TimeEntry.kind == "work")
                               .order_by(TimeEntry.start_at.desc()).limit(1)).first()
        if e:
            before = revisions.snapshot(e)
            e.end_at = e.end_at + timedelta(minutes=30)
            revisions.record(obj=e, action="update", actor=lead, subject_user_id=anna.id, before=before,
                             reason="Customer call after clock-out (confirmed by phone)")
    db.session.commit()
    yield "Demo data ready. Sign in as admin@example.nomail / luca.bianchi@example.nomail (lead) / anna.meier@example.nomail"
