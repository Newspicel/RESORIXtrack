# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Reports: monthly timesheet, balances overview, absences overview, raw export.

Each builder returns plain data; exporters render it as PDF (WeasyPrint), XLSX (openpyxl) or CSV.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime
from pathlib import Path
from typing import Any

from flask import render_template

from ..extensions import db
from ..models import TimeEntry, User
from ..timeutil import local_today, month_bounds, range_bounds_utc, zone
from . import absences as absences_svc
from . import accounts
from . import entries as entries_svc
from . import settings as settings_svc

STATIC = Path(__file__).resolve().parents[1] / "static"


def fmt_minutes(m: float | None, signed: bool = False) -> str:
    if m is None:
        return ""
    neg = m < 0
    m = abs(round(m))
    s = f"{int(m // 60)}:{int(m % 60):02d}"
    if signed:
        return ("−" if neg else "+") + s
    return ("−" + s) if neg else s


def fmt_days(d: float) -> str:
    return f"{d:g}"


# --------------------------------------------------------------------------- builders

def timesheet(user: User, year: int, month: int) -> dict[str, Any]:
    start, end = month_bounds(year, month)
    ctx = accounts.load_context(user, start, end, include_pending=False)
    ids = [e.id for e in ctx.entries]
    edited = entries_svc.edited_entry_ids(ids)
    days = accounts.compute_days(ctx, edited_entry_ids=edited)
    summary = accounts.summarize(days)
    prev_day = date.fromordinal(start.toordinal() - 1)
    balance_before = accounts.time_balance(user, prev_day)["balance_min"]
    today = local_today(user.timezone)
    balance_after = accounts.time_balance(user, min(end, today))["balance_min"] if start <= today else balance_before
    vac = accounts.vacation_account(user, year)
    tz = zone(user.timezone)
    # Entries per day for the printable sheet
    per_day: dict[str, list[dict[str, Any]]] = {}
    for e in ctx.entries:
        d = e.start_at.astimezone(tz).date().isoformat()
        per_day.setdefault(d, []).append({
            "kind": e.kind, "start": e.start_at.astimezone(tz).strftime("%H:%M"),
            "end": e.end_at.astimezone(tz).strftime("%H:%M") if e.end_at else "…",
            "edited": e.id in edited or e.source == "manual", "note": e.note})
    from . import worklog as worklog_svc

    logs: dict[str, list[dict[str, Any]]] = {}
    for w in worklog_svc.list_logs(user, start, end):
        logs.setdefault(w.date.isoformat(), []).append({"project": w.project.name if w.project else None, "customer_ref": w.customer_ref,
                                                        "note": w.note, "minutes": w.minutes,
                                                        "start": w.start_time.strftime("%H:%M") if w.start_time else None,
                                                        "end": w.end_time.strftime("%H:%M") if w.end_time else None})
    return {
        "report": "timesheet", "user": {"id": user.id, "name": user.name, "email": user.email,
                                        "team": user.team.name if user.team else None,
                                        "timezone": user.timezone},
        "worklog": logs, "worklog_mode": worklog_svc.config()["mode"],
        "year": year, "month": month, "days": [d.as_dict() for d in days], "entries": per_day,
        "summary": summary, "balance_before_min": balance_before, "balance_after_min": balance_after,
        "vacation": {k: vac[k] for k in ("entitlement", "carried_over", "taken", "planned", "remaining")},
        "company": settings_svc.get("company_name"),
        "signoff": _signoff_info(user, year, month),
    }


def _signoff_info(user: User, year: int, month: int) -> dict[str, Any] | None:
    from ..models import MonthSignoff
    from ..timeutil import iso

    row = db.session.scalar(db.select(MonthSignoff).where(
        MonthSignoff.user_id == user.id, MonthSignoff.month == f"{year:04d}-{month:02d}",
        MonthSignoff.reopened_at.is_(None)))
    if row is None:
        return None
    return {"signed_by": row.signed_by.name if row.signed_by else None, "signed_at": iso(row.signed_at),
            "seal": row.seal[:16]}


def balances(users: list[User], year: int, month: int | None) -> dict[str, Any]:
    if month:
        start, end = month_bounds(year, month)
    else:
        start, end = date(year, 1, 1), date(year, 12, 31)
    rows = []
    for u in users:
        ctx = accounts.load_context(u, start, end, include_pending=False)
        s = accounts.summarize(accounts.compute_days(ctx))
        bal = accounts.time_balance(u)
        vac = accounts.vacation_account(u, year)
        rows.append({"user_id": u.id, "name": u.name, "team": u.team.name if u.team else None,
                     "target_min": s["target_min"], "worked_min": s["worked_min"], "delta_min": s["delta_min"],
                     "balance_min": bal["balance_min"], "vacation_taken": vac["taken"],
                     "vacation_planned": vac["planned"], "vacation_remaining": vac["remaining"],
                     "vacation_pending": vac["pending"]})
    totals = {k: round(sum(r[k] for r in rows), 2) for k in ("target_min", "worked_min", "delta_min", "balance_min")}
    return {"report": "balances", "year": year, "month": month, "rows": rows, "totals": totals,
            "company": settings_svc.get("company_name")}


def absences_overview(users: list[User], start: date, end: date) -> dict[str, Any]:
    ids = [u.id for u in users]
    items = absences_svc.list_for_users(ids, start, end, statuses=("approved", "pending"))
    by_user: dict[int, dict[str, float]] = {u.id: {} for u in users}
    rows = []
    for a in items:
        clipped_start, clipped_end = max(a.start_date, start), min(a.end_date, end)
        sh = a.start_half if clipped_start == a.start_date else "full"
        eh = a.end_half if clipped_end == a.end_date else "full"
        if clipped_start == clipped_end and clipped_start != a.start_date:
            sh = "am" if (clipped_end == a.end_date and a.end_half == "am") else "full"
        days = accounts.count_absence_days(a.user, clipped_start, clipped_end, sh, eh)
        rows.append({"id": a.id, "user_id": a.user_id, "name": a.user.name, "type": a.type.label,
                     "type_key": a.type.key, "color": a.type.color, "status": a.status,
                     "start_date": a.start_date.isoformat(), "end_date": a.end_date.isoformat(),
                     "start_half": a.start_half, "end_half": a.end_half, "days": days, "note": a.note})
        if a.status == "approved":
            by_user[a.user_id][a.type.label] = by_user[a.user_id].get(a.type.label, 0) + days
    types = sorted({r["type"] for r in rows})
    summary = [{"user_id": u.id, "name": u.name, "by_type": by_user[u.id],
                "total": round(sum(by_user[u.id].values()), 2)} for u in users]
    return {"report": "absences", "start": start.isoformat(), "end": end.isoformat(), "rows": rows,
            "summary": summary, "types": types, "company": settings_svc.get("company_name")}


def raw_entries(users: list[User], start: date, end: date) -> list[dict[str, Any]]:
    out = []
    for u in users:
        s_utc, e_utc = range_bounds_utc(start, end, u.timezone)
        tz = zone(u.timezone)
        q = db.select(TimeEntry).where(TimeEntry.user_id == u.id, TimeEntry.start_at < e_utc,
                                       db.or_(TimeEntry.end_at.is_(None), TimeEntry.end_at > s_utc))
        entries = list(db.session.scalars(q.order_by(TimeEntry.start_at)))
        edited = entries_svc.edited_entry_ids([e.id for e in entries])
        for e in entries:
            out.append({
                "entry_id": e.id, "user_id": u.id, "name": u.name, "email": u.email, "kind": e.kind,
                "date": e.start_at.astimezone(tz).date().isoformat(),
                "start_local": e.start_at.astimezone(tz).strftime("%Y-%m-%d %H:%M"),
                "end_local": e.end_at.astimezone(tz).strftime("%Y-%m-%d %H:%M") if e.end_at else "",
                "start_utc": e.start_at.isoformat(), "end_utc": e.end_at.isoformat() if e.end_at else "",
                "minutes": round(((e.end_at or e.start_at) - e.start_at).total_seconds() / 60, 1),
                "timezone": u.timezone, "source": e.source, "edited": e.id in edited,
                "deleted": e.is_deleted, "note": e.note})
    return out


# --------------------------------------------------------------------------- exporters

LABELS = {
    "en": {
        "col_worklog": "Work log",
        "col_project": "Project",
        "col_code": "Code",
        "col_items": "Items",
        "projects": "Projects",
        "no_project": "No project",
        "customer": "Customer",
        "worklog": "Work log",
        "projects_sub": "Logged hours per project and person.",
        "col_date": "Date",
        "col_weekday": "Weekday",
        "col_holiday": "Public holiday",
        "col_absence": "Absence",
        "col_first_start": "First start",
        "col_last_end": "Last end",
        "col_break_h": "Break (h)",
        "col_worked_h": "Worked (h)",
        "col_target_h": "Target (h)",
        "col_delta_h": "Difference (h)",
        "col_balance_h": "Balance (h)",
        "col_edited": "Edited",
        "col_vacation_taken": "Vacation taken",
        "col_vacation_planned": "Vacation planned",
        "col_vacation_pending": "Vacation pending",
        "col_vacation_remaining": "Vacation remaining",
        "col_start": "First day",
        "col_end": "Last day",
        "col_start_half": "First day (part)",
        "col_end_half": "Last day (part)",
        "col_days": "Days",
        "col_note": "Note",
        "col_balance_before": "Balance at start of month",
        "col_balance_after": "Balance at end of month",
        "col_vacation_remaining_days": "Vacation remaining (days)",
        "col_entry_id": "Entry ID",
        "col_user_id": "Employee ID",
        "col_email": "Email",
        "col_kind": "Type",
        "col_start_local": "Start (local)",
        "col_end_local": "End (local)",
        "col_start_utc": "Start (UTC)",
        "col_end_utc": "End (UTC)",
        "col_minutes": "Minutes",
        "col_timezone": "Timezone",
        "col_source": "Source",
        "col_deleted": "Deleted",
        "yes": "yes",
        "half_full": "full day",
        "half_am": "morning",
        "half_pm": "afternoon",
        "kind_work": "work",
        "kind_break": "break",
        "status_rejected": "declined",
        "status_cancelled": "cancelled",
        "entries": "Time entries",
        "page": "Page", "generated": "Generated", "timesheet": "Timesheet", "timezone": "Timezone",
        "worked": "Worked", "target": "Target", "delta": "Delta", "balance": "Balance",
        "vacation_left": "Vacation left", "days": "days", "date": "Date", "times": "Times", "info": "Info",
        "break": "Break", "total": "Total", "balance_before": "Balance at start of month",
        "balance_after": "Balance at end of month", "vacation": "Vacation", "entitlement": "entitlement",
        "carried": "carried over", "taken": "Taken", "planned": "Planned", "left": "left", "pending": "Pending",
        "edited_note": "manually entered or changed; the full change history is available in RESORIXtrack.",
        "sign_employee": "Date, signature employee", "sign_lead": "Date, signature team lead",
        "break_warning": "break too short", "balances": "Balances", "signed_off": "Signed off by", "seal": "seal",
        "balances_sub": "Target, worked time and balance per person; vacation in days.",
        "name": "Name", "team": "Team", "absences": "Absences", "summary": "Summary", "details": "Details",
        "type": "Type", "status": "Status", "from": "From", "to": "To",
        "status_approved": "approved", "status_pending": "pending",
        "weekdays": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        "months": ["", "January", "February", "March", "April", "May", "June", "July", "August",
                   "September", "October", "November", "December"],
    },
    "de": {
        "col_worklog": "Tätigkeiten",
        "col_project": "Projekt",
        "col_code": "Kürzel",
        "col_items": "Einträge",
        "projects": "Projekte",
        "no_project": "Ohne Projekt",
        "customer": "Kunde",
        "worklog": "Tätigkeiten",
        "projects_sub": "Erfasste Stunden pro Projekt und Person.",
        "col_date": "Datum",
        "col_weekday": "Wochentag",
        "col_holiday": "Feiertag",
        "col_absence": "Abwesenheit",
        "col_first_start": "Erster Beginn",
        "col_last_end": "Letztes Ende",
        "col_break_h": "Pause (h)",
        "col_worked_h": "Ist (h)",
        "col_target_h": "Soll (h)",
        "col_delta_h": "Differenz (h)",
        "col_balance_h": "Saldo (h)",
        "col_edited": "Bearbeitet",
        "col_vacation_taken": "Ferien bezogen",
        "col_vacation_planned": "Ferien geplant",
        "col_vacation_pending": "Ferien beantragt",
        "col_vacation_remaining": "Ferien übrig",
        "col_start": "Erster Tag",
        "col_end": "Letzter Tag",
        "col_start_half": "Erster Tag (Teil)",
        "col_end_half": "Letzter Tag (Teil)",
        "col_days": "Tage",
        "col_note": "Notiz",
        "col_balance_before": "Saldo Monatsbeginn",
        "col_balance_after": "Saldo Monatsende",
        "col_vacation_remaining_days": "Ferien übrig (Tage)",
        "col_entry_id": "Eintrag-ID",
        "col_user_id": "Mitarbeiter-ID",
        "col_email": "E-Mail",
        "col_kind": "Art",
        "col_start_local": "Beginn (lokal)",
        "col_end_local": "Ende (lokal)",
        "col_start_utc": "Beginn (UTC)",
        "col_end_utc": "Ende (UTC)",
        "col_minutes": "Minuten",
        "col_timezone": "Zeitzone",
        "col_source": "Quelle",
        "col_deleted": "Gelöscht",
        "yes": "ja",
        "half_full": "ganzer Tag",
        "half_am": "Vormittag",
        "half_pm": "Nachmittag",
        "kind_work": "Arbeit",
        "kind_break": "Pause",
        "status_rejected": "abgelehnt",
        "status_cancelled": "storniert",
        "entries": "Zeiteinträge",
        "page": "Seite", "generated": "Erstellt", "timesheet": "Zeitnachweis", "timezone": "Zeitzone",
        "worked": "Ist", "target": "Soll", "delta": "Differenz", "balance": "Saldo",
        "vacation_left": "Ferien übrig", "days": "Tage", "date": "Datum", "times": "Zeiten", "info": "Info",
        "break": "Pause", "total": "Total", "balance_before": "Saldo Monatsanfang",
        "balance_after": "Saldo Monatsende", "vacation": "Ferien", "entitlement": "Anspruch",
        "carried": "Übertrag", "taken": "Bezogen", "planned": "Geplant", "left": "übrig", "pending": "Beantragt",
        "edited_note": "manuell erfasst oder geändert; der vollständige Änderungsverlauf ist in RESORIXtrack einsehbar.",
        "sign_employee": "Datum, Unterschrift Mitarbeitende", "sign_lead": "Datum, Unterschrift Teamleitung",
        "break_warning": "Pause zu kurz", "balances": "Saldi", "signed_off": "Abgezeichnet von", "seal": "Siegel",
        "balances_sub": "Soll, Ist und Saldo pro Person; Ferien in Tagen.",
        "name": "Name", "team": "Team", "absences": "Abwesenheiten", "summary": "Übersicht", "details": "Details",
        "type": "Art", "status": "Status", "from": "Von", "to": "Bis",
        "status_approved": "bewilligt", "status_pending": "beantragt",
        "weekdays": ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
        "months": ["", "Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
                   "September", "Oktober", "November", "Dezember"],
    },
    "fr": {
        "col_worklog": "Activités",
        "col_project": "Projet",
        "col_code": "Code",
        "col_items": "Entrées",
        "projects": "Projets",
        "no_project": "Sans projet",
        "customer": "Client",
        "worklog": "Activités",
        "projects_sub": "Heures saisies par projet et par personne.",
        "col_date": "Date",
        "col_weekday": "Jour",
        "col_holiday": "Jour férié",
        "col_absence": "Absence",
        "col_first_start": "Premier début",
        "col_last_end": "Dernière fin",
        "col_break_h": "Pause (h)",
        "col_worked_h": "Effectué (h)",
        "col_target_h": "Dû (h)",
        "col_delta_h": "Différence (h)",
        "col_balance_h": "Solde (h)",
        "col_edited": "Modifié",
        "col_vacation_taken": "Vacances prises",
        "col_vacation_planned": "Vacances planifiées",
        "col_vacation_pending": "Vacances en attente",
        "col_vacation_remaining": "Vacances restantes",
        "col_start": "Premier jour",
        "col_end": "Dernier jour",
        "col_start_half": "Premier jour (partie)",
        "col_end_half": "Dernier jour (partie)",
        "col_days": "Jours",
        "col_note": "Note",
        "col_balance_before": "Solde en début de mois",
        "col_balance_after": "Solde en fin de mois",
        "col_vacation_remaining_days": "Vacances restantes (jours)",
        "col_entry_id": "ID saisie",
        "col_user_id": "ID collaborateur",
        "col_email": "E-mail",
        "col_kind": "Type",
        "col_start_local": "Début (local)",
        "col_end_local": "Fin (local)",
        "col_start_utc": "Début (UTC)",
        "col_end_utc": "Fin (UTC)",
        "col_minutes": "Minutes",
        "col_timezone": "Fuseau horaire",
        "col_source": "Source",
        "col_deleted": "Supprimé",
        "yes": "oui",
        "half_full": "journée entière",
        "half_am": "matin",
        "half_pm": "après-midi",
        "kind_work": "travail",
        "kind_break": "pause",
        "status_rejected": "refusé",
        "status_cancelled": "annulé",
        "entries": "Saisies de temps",
        "page": "Page", "generated": "Généré le", "timesheet": "Relevé des heures", "timezone": "Fuseau horaire",
        "worked": "Effectué", "target": "Dû", "delta": "Différence", "balance": "Solde",
        "vacation_left": "Vacances restantes", "days": "jours", "date": "Date", "times": "Horaires", "info": "Info",
        "break": "Pause", "total": "Total", "balance_before": "Solde au début du mois",
        "balance_after": "Solde à la fin du mois", "vacation": "Vacances", "entitlement": "droit",
        "carried": "report", "taken": "Pris", "planned": "Planifié", "left": "restant", "pending": "En attente",
        "edited_note": "saisi ou modifié manuellement; l'historique complet des modifications est consultable dans RESORIXtrack.",
        "sign_employee": "Date, signature du collaborateur", "sign_lead": "Date, signature du responsable d'équipe",
        "break_warning": "pause trop courte", "balances": "Soldes", "signed_off": "Validé par", "seal": "sceau",
        "balances_sub": "Heures dues, heures effectuées et solde par personne; vacances en jours.",
        "name": "Nom", "team": "Équipe", "absences": "Absences", "summary": "Récapitulatif", "details": "Détails",
        "type": "Type", "status": "Statut", "from": "Du", "to": "Au",
        "status_approved": "approuvée", "status_pending": "en attente",
        "weekdays": ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
        "months": ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
                   "septembre", "octobre", "novembre", "décembre"],
    },
}


def _jinja_ctx(locale: str = "en") -> dict[str, Any]:
    from . import branding

    L = LABELS.get(locale, LABELS["en"])
    logo = branding.logo_path("light")  # the company's upload, or the built-in default
    return {"fmt": fmt_minutes, "fmt_days": fmt_days, "logo_uri": logo.as_uri() if logo.exists() else None,
            "generated": datetime.now().strftime("%Y-%m-%d %H:%M"), "L": L, "locale": locale,
            "weekday_names": L["weekdays"], "month_names": L["months"]}


HOLIDAY_NAMES_DE = {
    "New Year's Day": "Neujahr",
    "Good Friday": "Karfreitag",
    "Easter Sunday": "Ostersonntag",
    "Easter Monday": "Ostermontag",
    "Ascension Day": "Auffahrt",
    "Whit Monday": "Pfingstmontag",
    "Corpus Christi": "Fronleichnam",
    "Swiss National Day": "Bundesfeiertag",
    "National Day": "Bundesfeiertag",
    "Assumption Day": "Mariä Himmelfahrt",
    "Assumption of Mary": "Mariä Himmelfahrt",
    "All Saints' Day": "Allerheiligen",
    "Immaculate Conception": "Mariä Empfängnis",
    "Christmas Day": "Weihnachten",
    "Saint Stephen's Day": "Stephanstag",
    "St. Stephen's Day": "Stephanstag",
    "Saint Berchtold's Day": "Berchtoldstag",
    "Labor Day": "Tag der Arbeit",
    "Labour Day": "Tag der Arbeit",
    "Whit Sunday": "Pfingstsonntag",
    "Epiphany": "Heilige Drei Könige",
    "Christmas Eve (afternoon)": "Heiligabend (Nachmittag)",
    "New Year's Eve (afternoon)": "Silvester (Nachmittag)",
    "Saint Joseph's Day": "Josefstag",
    "Federal Day of Thanksgiving, Repentance and Prayer": "Eidgenössischer Bettag",
}

HOLIDAY_NAMES_FR = {
    "New Year's Day": "Nouvel An",
    "Good Friday": "Vendredi saint",
    "Easter Sunday": "Pâques",
    "Easter Monday": "Lundi de Pâques",
    "Ascension Day": "Ascension",
    "Whit Monday": "Lundi de Pentecôte",
    "Corpus Christi": "Fête-Dieu",
    "Swiss National Day": "Fête nationale",
    "National Day": "Fête nationale",
    "Assumption Day": "Assomption",
    "Assumption of Mary": "Assomption",
    "All Saints' Day": "Toussaint",
    "Immaculate Conception": "Immaculée Conception",
    "Christmas Day": "Noël",
    "Saint Stephen's Day": "Saint-Étienne",
    "St. Stephen's Day": "Saint-Étienne",
    "Saint Berchtold's Day": "Saint-Berchtold",
    "Labor Day": "Fête du travail",
    "Labour Day": "Fête du travail",
    "Whit Sunday": "Pentecôte",
    "Epiphany": "Épiphanie",
    "Christmas Eve (afternoon)": "Veille de Noël (après-midi)",
    "New Year's Eve (afternoon)": "Saint-Sylvestre (après-midi)",
    "Saint Joseph's Day": "Saint-Joseph",
    "Federal Day of Thanksgiving, Repentance and Prayer": "Jeûne fédéral",
}

HOLIDAY_NAMES = {"de": HOLIDAY_NAMES_DE, "fr": HOLIDAY_NAMES_FR}


def _localize(data: Any, locale: str) -> Any:
    """Translate absence type labels in report data (keys stay stable)."""
    from .mail import ABSENCE_LABELS

    absence_labels = ABSENCE_LABELS.get(locale)
    holiday_names = HOLIDAY_NAMES.get(locale)
    if not absence_labels or not holiday_names:
        return data

    def walk(x: Any) -> Any:
        if isinstance(x, dict):
            out = {k: walk(v) for k, v in x.items()}
            key = x.get("type_key") or (x.get("type") if isinstance(x.get("type"), str) else None)
            if key in absence_labels:
                if "label" in out:
                    out["label"] = absence_labels[key]
                if "type_key" in out:
                    out["type"] = absence_labels[key]
            if isinstance(out.get("holiday"), dict) and out["holiday"].get("name") in holiday_names:
                out["holiday"] = {**out["holiday"], "name": holiday_names[out["holiday"]["name"]]}
            return out
        if isinstance(x, list):
            return [walk(v) for v in x]
        return x

    return walk(data)


def _is_allowed_pdf_url(url: str) -> bool:
    """Defence in depth: the PDF renderer may only read our static files and the branding directory."""
    from urllib.parse import unquote, urlparse
    from urllib.request import url2pathname

    from . import branding

    parsed = urlparse(url)
    if parsed.scheme != "file":
        return False
    path = Path(url2pathname(unquote(parsed.path))).resolve()
    allowed = (STATIC.resolve(), branding.branding_dir().resolve())
    return any(path == root or root in path.parents for root in allowed)


def _pdf_url_fetcher():
    from weasyprint.urls import URLFetcher

    class RestrictedFetcher(URLFetcher):
        def fetch(self, url, headers=None):
            if not _is_allowed_pdf_url(url):
                raise ValueError(f"Resource not allowed in reports: {url}")
            return super().fetch(url, headers)

    return RestrictedFetcher()


def to_pdf(data: dict[str, Any], locale: str = "en") -> bytes:
    from weasyprint import HTML

    html = render_template(f"pdf/{data['report']}.html", d=_localize(data, locale), **_jinja_ctx(locale))
    return HTML(string=html, base_url=str(STATIC), url_fetcher=_pdf_url_fetcher()).write_pdf()


def _cell(v: Any) -> Any:
    """Spreadsheet formula injection: a note like `=HYPERLINK(...)` must stay text when opened in Excel."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def _xlsx(sheets: list[tuple[str, list[str], list[list[Any]]]]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    wb.remove(wb.active)
    head_fill = PatternFill("solid", fgColor="14254D")
    for title, header, rows in sheets:
        ws = wb.create_sheet(title[:31])
        ws.append(header)
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = head_fill
            c.alignment = Alignment(vertical="center")
        for r in rows:
            ws.append([_cell(x) for x in r])
        for i, col in enumerate(ws.columns, start=1):
            width = max((len(str(c.value)) for c in col if c.value is not None), default=8)
            ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = min(max(10, width + 2), 60)
        ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _hours(m: float) -> float:
    return round(m / 60.0, 2)


def _L(locale: str) -> dict[str, Any]:
    return LABELS.get(locale, LABELS["en"])


def _col(L: dict[str, Any], key: str) -> str:
    return L.get(f"col_{key}") or L.get(key) or key


def _status(L: dict[str, Any], status: str) -> str:
    return L.get(f"status_{status}", status)


def _yes(L: dict[str, Any], flag: bool) -> str:
    return L["yes"] if flag else ""


def _worklog_text(items: list[dict[str, Any]]) -> str:
    def one(w: dict[str, Any]) -> str:
        when = f"{w['start']}–{w['end']} " if w.get("start") else ""
        ref = w.get("project") or w.get("customer_ref") or ""
        what = f"{ref}: {w['note']}" if ref and w["note"] else (ref or w["note"])
        return f"{when}{what} ({_hours(w['minutes'])} h)".strip()
    return "; ".join(one(w) for w in items)


def _timesheet_rows(data: dict[str, Any], L: dict[str, Any]) -> tuple[list[str], list[list[Any]]]:
    header = [_col(L, k) for k in ("date", "weekday", "holiday", "absence", "first_start", "last_end", "break_h",
                                   "worked_h", "target_h", "delta_h", "edited", "worklog")]
    rows = []
    tz = zone(data["user"]["timezone"])
    logs = data.get("worklog") or {}
    for d in data["days"]:
        rows.append([
            d["date"], L["weekdays"][d["weekday"]],
            d["holiday"]["name"] if d["holiday"] else "",
            ", ".join(f"{a['label']} ({_status(L, a['status'])})" for a in d["absences"]),
            datetime.fromisoformat(d["first_start"]).astimezone(tz).strftime("%H:%M") if d["first_start"] else "",
            datetime.fromisoformat(d["last_end"]).astimezone(tz).strftime("%H:%M") if d["last_end"] else "",
            _hours(d["break_min"]), _hours(d["worked_min"]), _hours(d["target_min"]), _hours(d["delta_min"]),
            _yes(L, d["edited"]), _worklog_text(logs.get(d["date"], []))])
    s = data["summary"]
    rows.append([])
    rows.append([L["total"], "", "", "", "", "", "", _hours(s["worked_min"]), _hours(s["target_min"]), _hours(s["delta_min"]), "", ""])
    rows.append([_col(L, "balance_before"), "", "", "", "", "", "", "", "", _hours(data["balance_before_min"]), "", ""])
    rows.append([_col(L, "balance_after"), "", "", "", "", "", "", "", "", _hours(data["balance_after_min"]), "", ""])
    rows.append([_col(L, "vacation_remaining_days"), "", "", "", "", "", "", "", "", data["vacation"]["remaining"], "", ""])
    return header, rows


def _projects_rows(data: dict[str, Any], L: dict[str, Any]) -> tuple[list[str], list[list[Any]]]:
    header = [_col(L, k) for k in ("project", "code", "team", "name", "worked_h", "items")]
    rows = []
    def pname(p: dict[str, Any]) -> str:
        return f"{L['customer']} {p['name']}" if p.get("kind") == "customer" else (p["name"] or L["no_project"])
    for p in data["projects"]:
        for person in p["people"]:
            rows.append([pname(p), p["code"], p["team"] or "", person["name"], _hours(person["minutes"]), ""])
        rows.append([pname(p), p["code"], p["team"] or "", L["total"], _hours(p["minutes"]), p["items"]])
    return header, rows


def _balances_rows(data: dict[str, Any], L: dict[str, Any]) -> tuple[list[str], list[list[Any]]]:
    header = [_col(L, k) for k in ("name", "team", "target_h", "worked_h", "delta_h", "balance_h", "vacation_taken",
                                   "vacation_planned", "vacation_pending", "vacation_remaining")]
    rows = [[r["name"], r["team"] or "", _hours(r["target_min"]), _hours(r["worked_min"]), _hours(r["delta_min"]),
             _hours(r["balance_min"]), r["vacation_taken"], r["vacation_planned"], r["vacation_pending"],
             r["vacation_remaining"]] for r in data["rows"]]
    return header, rows


def _absences_rows(data: dict[str, Any], L: dict[str, Any]) -> tuple[list[str], list[list[Any]]]:
    header = [_col(L, k) for k in ("name", "type", "status", "start", "end", "start_half", "end_half", "days", "note")]
    rows = [[r["name"], r["type"], _status(L, r["status"]), r["start_date"], r["end_date"],
             L.get(f"half_{r['start_half']}", r["start_half"]), L.get(f"half_{r['end_half']}", r["end_half"]),
             r["days"], r["note"]] for r in data["rows"]]
    return header, rows


def _raw_rows(rows: list[dict[str, Any]], L: dict[str, Any]) -> tuple[list[str], list[list[Any]]]:
    keys = list(rows[0].keys()) if rows else ["entry_id"]
    header = [_col(L, k) for k in keys]
    out = []
    for r in rows:
        row = []
        for k in keys:
            v = r[k]
            if k == "kind":
                v = L.get(f"kind_{v}", v)
            elif isinstance(v, bool):
                v = _yes(L, v)
            row.append(v)
        out.append(row)
    return header, out


def to_xlsx(data: dict[str, Any], locale: str = "en") -> bytes:
    """Spreadsheet export with localised headers and values (same language as the PDF)."""
    L = _L(locale)
    data = _localize(data, locale)
    kind = data["report"]
    if kind == "timesheet":
        header, rows = _timesheet_rows(data, L)
        return _xlsx([(f"{data['year']}-{data['month']:02d}", header, rows)])
    if kind == "balances":
        header, rows = _balances_rows(data, L)
        return _xlsx([(L["balances"], header, rows)])
    if kind == "absences":
        header, rows = _absences_rows(data, L)
        sum_header = [_col(L, "name"), *data["types"], L["total"]]
        sum_rows = [[s["name"], *[s["by_type"].get(t, 0) for t in data["types"]], s["total"]] for s in data["summary"]]
        return _xlsx([(L["absences"], header, rows), (L["summary"], sum_header, sum_rows)])
    if kind == "projects":
        header, rows = _projects_rows(data, L)
        return _xlsx([(L["projects"], header, rows)])
    raise ValueError(kind)


def to_csv_rows(header: list[str], rows: list[list[Any]]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(header)
    w.writerows([_cell(x) for x in r] for r in rows)
    return ("\ufeff" + buf.getvalue()).encode("utf-8")  # BOM so Excel detects UTF-8


def to_csv(data: dict[str, Any] | list[dict[str, Any]], locale: str = "en") -> bytes:
    L = _L(locale)
    if isinstance(data, list):
        return to_csv_rows(*_raw_rows(data, L))
    data = _localize(data, locale)
    kind = data["report"]
    if kind == "balances":
        return to_csv_rows(*_balances_rows(data, L))
    if kind == "absences":
        return to_csv_rows(*_absences_rows(data, L))
    if kind == "projects":
        return to_csv_rows(*_projects_rows(data, L))
    if kind == "timesheet":
        header, rows = _timesheet_rows(data, L)
        return to_csv_rows(header, [r for r in rows if r])
    raise ValueError(kind)


def raw_to_xlsx(rows: list[dict[str, Any]], locale: str = "en") -> bytes:
    L = _L(locale)
    header, out = _raw_rows(rows, L)
    return _xlsx([(L["entries"], header, out)])

