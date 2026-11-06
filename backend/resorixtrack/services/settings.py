# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Company-wide settings stored as key/value JSON with typed defaults."""

from __future__ import annotations

import re
from typing import Any

from ..errors import Validation
from ..extensions import db
from ..models import Setting
from ..timeutil import is_valid_tz

DEFAULTS: dict[str, Any] = {
    "company_name": "RESORIX AG",
    "default_timezone": "Europe/Zurich",
    "default_locale": "en",
    # Holidays: "scheduled" = holiday only reduces target on the person's scheduled workday;
    # "prorata" = every Mon-Fri holiday credits pensum x full-time daily minutes.
    "holiday_mode": "scheduled",
    "fulltime_weekly_minutes": 2520,  # 42 h, used for pro-rata holidays and schedule defaults
    "default_vacation_days": 25.0,  # full-time entitlement proposed for new employees
    # Off: the days entered per person are their own days. On: full-time values scaled by scheduled days/week.
    "vacation_prorate_workdays": False,
    "holiday_work_surcharge_percent": 0,
    "lead_can_edit_schedules": True,
    "lead_can_adjust_balances": True,
    "reason_required_for_past_edits": True,
    "sick_self_report_backdate_days": 3,
    "sick_self_report_max_days": 30,
    "clock_reminder_hours": 10,
    "session_remember_days": 30,
    "weekly_max_minutes": 2700,  # 45 h (CH ArG for office/technical staff)
    "break_rules_enabled": True,
    "login_log_retention_days": 365,
    "setup_complete": False,
    "getting_started_dismissed": False,
    "brand_accent": "",  # "#rrggbb" or "" for the default
    "mfa_required_for_admins": False,  # administrators are reminded until they enable two-factor auth
    "mfa_required_for_all": False,  # ... or everyone
    "api_tokens_enabled": True,  # personal access tokens for desktop apps / scripts
    # Work log ("what did I do"): off | optional | required; required = at least N % of the worked
    # minutes of each day must be annotated; optionally every item needs a project.
    "worklog_mode": "optional",
    "worklog_required_percent": 80,
    "worklog_project_required": False,
}

_VALIDATORS = {
    "company_name": lambda v: isinstance(v, str) and 0 < len(v) <= 120,
    "default_timezone": lambda v: isinstance(v, str) and is_valid_tz(v),
    "default_locale": lambda v: isinstance(v, str) and 2 <= len(v) <= 16,
    "holiday_mode": lambda v: v in ("scheduled", "prorata"),
    "fulltime_weekly_minutes": lambda v: isinstance(v, int) and 60 <= v <= 6000,
    "default_vacation_days": lambda v: isinstance(v, int | float) and 0 <= v <= 366,
    "vacation_prorate_workdays": lambda v: isinstance(v, bool),
    "holiday_work_surcharge_percent": lambda v: isinstance(v, int | float) and 0 <= v <= 200,
    "lead_can_edit_schedules": lambda v: isinstance(v, bool),
    "lead_can_adjust_balances": lambda v: isinstance(v, bool),
    "reason_required_for_past_edits": lambda v: isinstance(v, bool),
    "sick_self_report_backdate_days": lambda v: isinstance(v, int) and 0 <= v <= 60,
    "sick_self_report_max_days": lambda v: isinstance(v, int) and 1 <= v <= 365,
    "clock_reminder_hours": lambda v: isinstance(v, int) and 0 <= v <= 24,
    "session_remember_days": lambda v: isinstance(v, int) and 1 <= v <= 365,
    "weekly_max_minutes": lambda v: isinstance(v, int) and 60 <= v <= 6000,
    "break_rules_enabled": lambda v: isinstance(v, bool),
    "login_log_retention_days": lambda v: isinstance(v, int) and 30 <= v <= 3650,
    "setup_complete": lambda v: isinstance(v, bool),
    "getting_started_dismissed": lambda v: isinstance(v, bool),
    "mfa_required_for_admins": lambda v: isinstance(v, bool),
    "mfa_required_for_all": lambda v: isinstance(v, bool),
    "api_tokens_enabled": lambda v: isinstance(v, bool),
    "worklog_mode": lambda v: v in ("off", "optional", "required"),
    "worklog_required_percent": lambda v: isinstance(v, int) and 1 <= v <= 100,
    "worklog_project_required": lambda v: isinstance(v, bool),
    "brand_accent": lambda v: isinstance(v, str) and (v == "" or re.fullmatch(r"#[0-9a-f]{6}", v) is not None),
}

PUBLIC_KEYS = ("company_name", "default_timezone", "default_locale", "setup_complete")


def get(key: str) -> Any:
    row = db.session.get(Setting, key)
    return row.value if row is not None else DEFAULTS[key]


def get_all() -> dict[str, Any]:
    values = dict(DEFAULTS)
    for row in db.session.scalars(db.select(Setting)):
        if row.key in values:
            values[row.key] = row.value
    return values


def update(changes: dict[str, Any]) -> dict[str, Any]:
    errors = {}
    for key, value in changes.items():
        if key not in DEFAULTS:
            errors[key] = "Unknown setting"
        elif not _VALIDATORS[key](value):
            errors[key] = "Invalid value"
    if errors:
        raise Validation("Invalid settings", fields=errors)
    for key, value in changes.items():
        row = db.session.get(Setting, key)
        if row is None:
            db.session.add(Setting(key=key, value=value))
        else:
            row.value = value
    db.session.flush()
    return get_all()
