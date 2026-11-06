# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Request schemas (validation + OpenAPI). Responses are documented as plain JSON objects."""

from __future__ import annotations

import re
from datetime import date

from marshmallow import EXCLUDE, Schema, ValidationError, fields, validate, validates_schema

from ..auth import SCOPES

HALF = validate.OneOf(["full", "am", "pm"])
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# Dates outside this window are meaningless for time tracking and would overflow timezone maths.
DATE_RANGE = validate.Range(min=date(1990, 1, 1), max=date(2100, 12, 31))


class Base(Schema):
    class Meta:
        unknown = EXCLUDE

    @validates_schema
    def _no_control_characters(self, data, **kwargs):
        """No control characters in any free-text field (mail headers, exports, logs)."""
        for key, value in data.items():
            if isinstance(value, str) and _CONTROL.search(value):
                raise ValidationError("Contains invalid control characters", key)


# ----------------------------------------------------------------------------- auth
class LoginIn(Base):
    email = fields.String(required=True, validate=validate.Length(max=254))
    password = fields.String(required=True, validate=validate.Length(max=256))
    remember = fields.Boolean(load_default=True)


class EmailIn(Base):
    email = fields.String(required=True, validate=validate.Length(max=254))


class TokenPasswordIn(Base):
    token = fields.String(required=True, validate=validate.Length(max=200))
    password = fields.String(required=True, validate=validate.Length(max=256))
    locale = fields.String(load_default=None, allow_none=True, validate=validate.OneOf(["en", "de", "fr"]))
    timezone = fields.String(load_default=None, allow_none=True)


class MfaLoginIn(Base):
    mfa_token = fields.String(required=True, validate=validate.Length(max=200))
    code = fields.String(required=True, validate=validate.Length(min=1, max=40))
    remember = fields.Boolean(load_default=True)


class MfaPasswordIn(Base):
    current_password = fields.String(required=True, validate=validate.Length(max=256))


class MfaCodeIn(Base):
    code = fields.String(required=True, validate=validate.Length(min=1, max=40))


class MfaPasswordCodeIn(Base):
    current_password = fields.String(required=True, validate=validate.Length(max=256))
    code = fields.String(required=True, validate=validate.Length(min=1, max=40))


class TokenQuery(Base):
    token = fields.String(required=True, validate=validate.Length(max=200))


class ChangePasswordIn(Base):
    current_password = fields.String(required=True, validate=validate.Length(max=256))
    new_password = fields.String(required=True, validate=validate.Length(max=256))


class SetupIn(Base):
    setup_code = fields.String(load_default=None, allow_none=True, validate=validate.Length(max=40))
    company_name = fields.String(required=True, validate=validate.Length(min=1, max=120))
    timezone = fields.String(load_default="Europe/Zurich")
    employment_start = fields.Date(load_default=None, allow_none=True, validate=DATE_RANGE)
    fulltime_weekly_minutes = fields.Integer(load_default=None, allow_none=True, validate=validate.Range(60, 6000))
    default_vacation_days = fields.Float(load_default=None, allow_none=True, validate=validate.Range(0, 366))
    admin_name = fields.String(required=True, validate=validate.Length(min=1, max=120))
    admin_email = fields.String(required=True, validate=validate.Length(max=254))
    admin_password = fields.String(required=True, validate=validate.Length(max=256))
    locale = fields.String(load_default="en", validate=validate.OneOf(["en", "de", "fr"]))
    # Built-in preset (e.g. "ch-fr-fribourg") or import from python-holidays via country/subdiv.
    holiday_preset = fields.String(load_default="ch-fr-fribourg", allow_none=True)
    holiday_country = fields.String(load_default=None, allow_none=True)
    holiday_subdiv = fields.String(load_default=None, allow_none=True)


# ----------------------------------------------------------------------------- me / profile
class ProfileIn(Base):
    name = fields.String(validate=validate.Length(min=1, max=120))
    timezone = fields.String()
    locale = fields.String(validate=validate.OneOf(["en", "de", "fr"]))
    time_format = fields.String(validate=validate.OneOf(["24h", "12h"]))
    notify_email_on_correction = fields.Boolean()


# ----------------------------------------------------------------------------- clock / entries
class ClockIn(Base):
    at = fields.DateTime(load_default=None, allow_none=True)
    # true when the person chose the time by hand (clock in "with a custom time"): the entry is then marked as manual
    custom = fields.Boolean(load_default=False)
    note = fields.String(load_default="", validate=validate.Length(max=500))


class RangeQuery(Base):
    from_ = fields.Date(data_key="from", required=True, validate=DATE_RANGE)
    to = fields.Date(required=True, validate=DATE_RANGE)
    user_id = fields.Integer(load_default=None)
    include_deleted = fields.Boolean(load_default=False)

    @validates_schema
    def _check(self, data, **kwargs):
        if data["to"] < data["from_"]:
            raise ValidationError("'to' is before 'from'", "to")
        if (data["to"] - data["from_"]).days > 400:
            raise ValidationError("Range too large (max 400 days)", "to")


class TeamRangeQuery(Base):
    from_ = fields.Date(data_key="from", required=True, validate=DATE_RANGE)
    to = fields.Date(required=True, validate=DATE_RANGE)
    team_id = fields.Integer(load_default=None)
    user_id = fields.Integer(load_default=None)
    status = fields.String(load_default=None)

    @validates_schema
    def _check(self, data, **kwargs):
        if data["to"] < data["from_"]:
            raise ValidationError("'to' is before 'from'", "to")
        if (data["to"] - data["from_"]).days > 731:
            raise ValidationError("Range too large (max 2 years)", "to")


class EntryIn(Base):
    user_id = fields.Integer(load_default=None)
    kind = fields.String(load_default="work", validate=validate.OneOf(["work", "break"]))
    start_at = fields.DateTime(required=True)
    end_at = fields.DateTime(required=True)
    note = fields.String(load_default="", validate=validate.Length(max=500))
    reason = fields.String(load_default="", validate=validate.Length(max=500))


class EntryPatch(Base):
    kind = fields.String(validate=validate.OneOf(["work", "break"]))
    start_at = fields.DateTime()
    end_at = fields.DateTime(allow_none=True)
    note = fields.String(validate=validate.Length(max=500))
    reason = fields.String(load_default="", validate=validate.Length(max=500))


class ReasonIn(Base):
    reason = fields.String(load_default="", validate=validate.Length(max=1000))


class NoteIn(Base):
    note = fields.String(load_default="", validate=validate.Length(max=1000))


class DisputeIn(Base):
    message = fields.String(required=True, validate=validate.Length(min=1, max=500))


# ----------------------------------------------------------------------------- absences
class AbsenceIn(Base):
    user_id = fields.Integer(load_default=None)
    type = fields.Raw(required=True, metadata={"description": "absence type id or key"})
    start_date = fields.Date(required=True, validate=DATE_RANGE)
    end_date = fields.Date(load_default=None, allow_none=True, validate=DATE_RANGE)
    start_half = fields.String(load_default="full", validate=HALF)
    end_half = fields.String(load_default="full", validate=HALF)
    note = fields.String(load_default="", validate=validate.Length(max=1000))


class AbsencePatch(Base):
    start_date = fields.Date(validate=DATE_RANGE)
    end_date = fields.Date(validate=DATE_RANGE)
    start_half = fields.String(validate=HALF)
    end_half = fields.String(validate=HALF)
    note = fields.String(validate=validate.Length(max=1000))
    reason = fields.String(load_default="", validate=validate.Length(max=1000))


class AbsencePreviewQuery(Base):
    user_id = fields.Integer(load_default=None)
    type = fields.String(load_default="vacation")
    start_date = fields.Date(required=True, validate=DATE_RANGE)
    end_date = fields.Date(load_default=None, validate=DATE_RANGE)
    start_half = fields.String(load_default="full", validate=HALF)
    end_half = fields.String(load_default="full", validate=HALF)


class SickCheckQuery(Base):
    date = fields.Date(load_default=None, validate=DATE_RANGE)


class AbsenceTypeIn(Base):
    key = fields.String(validate=validate.Regexp(r"^[a-z][a-z0-9_]{1,31}$"))
    label = fields.String(validate=validate.Length(min=1, max=80))
    color = fields.String(validate=validate.Regexp(r"^#[0-9a-fA-F]{6}$"))
    category = fields.String(validate=validate.OneOf(["vacation", "sick", "other"]))
    credits_time = fields.Boolean()
    deducts_vacation = fields.Boolean()
    requires_approval = fields.Boolean()
    allows_attachments = fields.Boolean()
    employee_can_request = fields.Boolean()
    is_active = fields.Boolean()
    sort = fields.Integer()


# ----------------------------------------------------------------------------- users / teams
class ScheduleMinutes(Base):
    mon = fields.Integer(validate=validate.Range(0, 1440))
    tue = fields.Integer(validate=validate.Range(0, 1440))
    wed = fields.Integer(validate=validate.Range(0, 1440))
    thu = fields.Integer(validate=validate.Range(0, 1440))
    fri = fields.Integer(validate=validate.Range(0, 1440))
    sat = fields.Integer(validate=validate.Range(0, 1440))
    sun = fields.Integer(validate=validate.Range(0, 1440))


class UserIn(Base):
    email = fields.String(required=True, validate=validate.Length(max=254))
    name = fields.String(required=True, validate=validate.Length(min=1, max=120))
    role = fields.String(load_default="employee", validate=validate.OneOf(["admin", "employee"]))
    capabilities = fields.List(fields.String(validate=validate.OneOf(["hr", "projects"])), load_default=None, allow_none=True)
    team_id = fields.Integer(load_default=None, allow_none=True)
    holiday_calendar_id = fields.Integer(load_default=None, allow_none=True)
    timezone = fields.String(load_default=None, allow_none=True)
    locale = fields.String(load_default=None, allow_none=True)
    time_format = fields.String(load_default=None, allow_none=True, validate=validate.OneOf(["24h", "12h"]))
    employment_start = fields.Date(load_default=None, allow_none=True, validate=DATE_RANGE)
    employment_end = fields.Date(load_default=None, allow_none=True, validate=DATE_RANGE)
    vacation_days_per_year = fields.Float(load_default=None, allow_none=True, validate=validate.Range(0, 366))
    pensum_percent = fields.Float(load_default=100.0, validate=validate.Range(1, 100))
    schedule_minutes = fields.Nested(ScheduleMinutes, load_default=None, allow_none=True)
    opening_balance_min = fields.Float(load_default=0)
    send_invite = fields.Boolean(load_default=True)


class AnonymizeIn(Base):
    admin_password = fields.String(required=True, validate=validate.Length(max=256))
    force = fields.Boolean(load_default=False)


class SetPasswordIn(Base):
    password = fields.String(required=True, validate=validate.Length(max=256))
    notify = fields.Boolean(load_default=True)
    # The administrator confirms their own password: a hijacked admin session alone is not enough.
    admin_password = fields.String(required=True, validate=validate.Length(max=256))


class UserPatch(Base):
    email = fields.String(validate=validate.Length(max=254))
    name = fields.String(validate=validate.Length(min=1, max=120))
    role = fields.String(validate=validate.OneOf(["admin", "employee"]))
    capabilities = fields.List(fields.String(validate=validate.OneOf(["hr", "projects"])), allow_none=True)
    team_id = fields.Integer(allow_none=True)
    holiday_calendar_id = fields.Integer(allow_none=True)
    timezone = fields.String()
    time_format = fields.String(validate=validate.OneOf(["24h", "12h"]))
    locale = fields.String()
    employment_start = fields.Date(allow_none=True, validate=DATE_RANGE)
    employment_end = fields.Date(allow_none=True, validate=DATE_RANGE)
    vacation_days_per_year = fields.Float(validate=validate.Range(0, 366))
    is_active = fields.Boolean()


class ScheduleIn(Base):
    valid_from = fields.Date(required=True, validate=DATE_RANGE)
    pensum_percent = fields.Float(load_default=100.0, validate=validate.Range(1, 100))
    minutes = fields.Nested(ScheduleMinutes, required=True)
    reason = fields.String(load_default="", validate=validate.Length(max=500))


class SchedulePatch(Base):
    valid_from = fields.Date(validate=DATE_RANGE)
    pensum_percent = fields.Float(validate=validate.Range(1, 100))
    minutes = fields.Nested(ScheduleMinutes)
    reason = fields.String(load_default="", validate=validate.Length(max=500))


class TeamLeadIn(Base):
    user_id = fields.Integer(required=True)
    role = fields.String(load_default="lead", validate=validate.OneOf(["lead", "deputy"]))
    valid_from = fields.Date(load_default=None, allow_none=True, validate=DATE_RANGE)
    valid_to = fields.Date(load_default=None, allow_none=True, validate=DATE_RANGE)


class TeamIn(Base):
    name = fields.String(validate=validate.Length(min=1, max=120))
    color = fields.String(validate=validate.Regexp(r"^#[0-9a-fA-F]{6}$"))
    holiday_calendar_id = fields.Integer(allow_none=True)
    member_ids = fields.List(fields.Integer())
    leads = fields.List(fields.Nested(TeamLeadIn), load_default=None, allow_none=True)


class AdjustmentIn(Base):
    account = fields.String(required=True, validate=validate.OneOf(["time", "vacation"]))
    amount = fields.Float(required=True, metadata={"description": "minutes (time) or days (vacation)"})
    effective_date = fields.Date(load_default=None, validate=DATE_RANGE)
    kind = fields.String(load_default="correction", validate=validate.OneOf(["opening", "payout", "correction"]))
    reason = fields.String(required=True, validate=validate.Length(min=1, max=500))


class EntitlementIn(Base):
    days = fields.Float(required=True, allow_none=True, validate=validate.Range(0, 366))
    note = fields.String(load_default="", validate=validate.Length(max=500))


class YearQuery(Base):
    year = fields.Integer(load_default=None, validate=validate.Range(1990, 2100))


# ----------------------------------------------------------------------------- holidays
class CalendarIn(Base):
    name = fields.String(validate=validate.Length(min=1, max=120))
    region_code = fields.String(validate=validate.Length(max=32))
    description = fields.String(validate=validate.Length(max=500))
    is_default = fields.Boolean()


class HolidayIn(Base):
    date = fields.Date(required=True, validate=DATE_RANGE)
    name = fields.String(required=True, validate=validate.Length(min=1, max=120))
    fraction = fields.Float(load_default=1.0, validate=validate.OneOf([0.5, 1.0]))


class HolidayPatch(Base):
    date = fields.Date(validate=DATE_RANGE)
    name = fields.String(validate=validate.Length(min=1, max=120))
    fraction = fields.Float(validate=validate.OneOf([0.5, 1.0]))


class ImportIn(Base):
    country = fields.String(required=True, validate=validate.Length(min=2, max=3))
    subdiv = fields.String(load_default=None, allow_none=True)
    year = fields.Integer(required=True, validate=validate.Range(1990, 2100))
    include_half_days = fields.Boolean(load_default=False)
    replace = fields.Boolean(load_default=False)


# ----------------------------------------------------------------------------- reports
FORMAT = validate.OneOf(["json", "pdf", "xlsx", "csv"])


class TimesheetQuery(Base):
    user_id = fields.Integer(load_default=None)
    year = fields.Integer(required=True, validate=validate.Range(1990, 2100))
    month = fields.Integer(required=True, validate=validate.Range(1, 12))
    format = fields.String(load_default="json", validate=FORMAT)


class BalancesQuery(Base):
    year = fields.Integer(required=True, validate=validate.Range(1990, 2100))
    month = fields.Integer(load_default=None, validate=validate.Range(1, 12))
    team_id = fields.Integer(load_default=None)
    format = fields.String(load_default="json", validate=FORMAT)


class ReportRangeQuery(Base):
    from_ = fields.Date(data_key="from", required=True, validate=DATE_RANGE)
    to = fields.Date(required=True, validate=DATE_RANGE)
    team_id = fields.Integer(load_default=None)
    user_id = fields.Integer(load_default=None)
    format = fields.String(load_default="json", validate=FORMAT)

    @validates_schema
    def _check(self, data, **kwargs):
        if data["to"] < data["from_"]:
            raise ValidationError("'to' is before 'from'", "to")
        if (data["to"] - data["from_"]).days > 731:
            raise ValidationError("Range too large (max 2 years)", "to")


# ----------------------------------------------------------------------------- misc
class ReadIn(Base):
    ids = fields.List(fields.Integer(), load_default=None, allow_none=True)


class TokenIn(Base):
    name = fields.String(required=True, validate=validate.Length(min=1, max=80))
    scopes = fields.List(fields.String(validate=validate.OneOf(SCOPES)), load_default=lambda: ["clock", "entries:read"])
    expires_in_days = fields.Integer(load_default=None, allow_none=True, validate=validate.Range(1, 365))
    current_password = fields.String(required=True, validate=validate.Length(max=256))


class AppTokenIn(Base):
    """Sign-in from an app: password, the two-factor code when enabled, and the token to create."""

    email = fields.String(required=True, validate=validate.Length(max=254))
    password = fields.String(required=True, validate=validate.Length(max=256))
    code = fields.String(load_default=None, allow_none=True, validate=validate.Length(max=32))
    name = fields.String(required=True, validate=validate.Length(min=1, max=80))
    scopes = fields.List(fields.String(validate=validate.OneOf(SCOPES)), load_default=lambda: ["clock", "entries:read"])
    expires_in_days = fields.Integer(load_default=None, allow_none=True, validate=validate.Range(1, 365))


class SmtpTestIn(Base):
    to = fields.String(load_default=None, allow_none=True)


class TokenRevokeIn(Base):
    reason = fields.String(load_default="", validate=validate.Length(max=500))


class TokenListQuery(Base):
    include_inactive = fields.Boolean(load_default=False)


class ProjectIn(Base):
    name = fields.String(required=True, validate=validate.Length(min=1, max=120))
    code = fields.String(load_default="", validate=validate.Length(max=30))
    color = fields.String(load_default="#35a1cc", validate=validate.Regexp(r"^#[0-9a-fA-F]{6}$"))
    description = fields.String(load_default="", validate=validate.Length(max=500))
    team_id = fields.Integer(load_default=None, allow_none=True)
    is_active = fields.Boolean(load_default=True)


class ProjectPatch(Base):
    name = fields.String(validate=validate.Length(min=1, max=120))
    code = fields.String(validate=validate.Length(max=30))
    color = fields.String(validate=validate.Regexp(r"^#[0-9a-fA-F]{6}$"))
    description = fields.String(validate=validate.Length(max=500))
    team_id = fields.Integer(allow_none=True)
    is_active = fields.Boolean()


class ProjectQuery(Base):
    include_inactive = fields.Boolean(load_default=False)


class WorkLogIn(Base):
    user_id = fields.Integer(load_default=None)
    date = fields.Date(required=True, validate=DATE_RANGE)
    # either a duration, or exact times (then the duration is derived)
    minutes = fields.Integer(load_default=None, allow_none=True, validate=validate.Range(1, 1440))
    start_time = fields.Time(load_default=None, allow_none=True)
    end_time = fields.Time(load_default=None, allow_none=True)
    project_id = fields.Integer(load_default=None, allow_none=True)
    customer_ref = fields.String(load_default="", validate=validate.Length(max=60))
    note = fields.String(load_default="", validate=validate.Length(max=2000))
    reason = fields.String(load_default="", validate=validate.Length(max=500))


class WorkLogPatch(Base):
    date = fields.Date(validate=DATE_RANGE)
    minutes = fields.Integer(allow_none=True, validate=validate.Range(1, 1440))
    start_time = fields.Time(allow_none=True)
    end_time = fields.Time(allow_none=True)
    project_id = fields.Integer(allow_none=True)
    customer_ref = fields.String(validate=validate.Length(max=60))
    note = fields.String(validate=validate.Length(max=2000))
    reason = fields.String(load_default="", validate=validate.Length(max=500))


class BackupIn(Base):
    include_attachments = fields.Boolean(load_default=True)


class AuditQuery(Base):
    user_id = fields.Integer(load_default=None)
    entity = fields.String(load_default=None)
    from_ = fields.Date(data_key="from", load_default=None, validate=DATE_RANGE)
    to = fields.Date(load_default=None, validate=DATE_RANGE)
    limit = fields.Integer(load_default=200, validate=validate.Range(1, 1000))
    offset = fields.Integer(load_default=0, validate=validate.Range(0))


class SignoffIn(Base):
    month = fields.String(required=True, validate=validate.Regexp(r"^\d{4}-(0[1-9]|1[0-2])$"))
    user_ids = fields.List(fields.Integer(), required=True, validate=validate.Length(min=1, max=500))
    note = fields.String(load_default="", validate=validate.Length(max=500))


class SignoffQuery(Base):
    month = fields.String(load_default=None, validate=validate.Regexp(r"^\d{4}-(0[1-9]|1[0-2])$"))
    user_id = fields.Integer(load_default=None)
    team_id = fields.Integer(load_default=None)


class LoginLogQuery(Base):
    email = fields.String(load_default=None)
    success = fields.Boolean(load_default=None, allow_none=True)
    from_ = fields.Date(data_key="from", load_default=None, validate=DATE_RANGE)
    to = fields.Date(load_default=None, validate=DATE_RANGE)
    limit = fields.Integer(load_default=100, validate=validate.Range(1, 1000))
    offset = fields.Integer(load_default=0, validate=validate.Range(0))


class SettingsIn(Schema):
    class Meta:
        unknown = EXCLUDE

    company_name = fields.String()
    default_timezone = fields.String()
    default_locale = fields.String()
    holiday_mode = fields.String(validate=validate.OneOf(["scheduled", "prorata"]))
    fulltime_weekly_minutes = fields.Integer()
    default_vacation_days = fields.Float()
    vacation_prorate_workdays = fields.Boolean()
    holiday_work_surcharge_percent = fields.Float()
    lead_can_edit_schedules = fields.Boolean()
    lead_can_adjust_balances = fields.Boolean()
    reason_required_for_past_edits = fields.Boolean()
    sick_self_report_backdate_days = fields.Integer()
    sick_self_report_max_days = fields.Integer()
    clock_reminder_hours = fields.Integer()
    session_remember_days = fields.Integer()
    weekly_max_minutes = fields.Integer()
    break_rules_enabled = fields.Boolean()
    login_log_retention_days = fields.Integer()
    mfa_required_for_admins = fields.Boolean()
    mfa_required_for_all = fields.Boolean()
    api_tokens_enabled = fields.Boolean()
    worklog_mode = fields.String(validate=validate.OneOf(["off", "optional", "required"]))
    worklog_required_percent = fields.Integer(validate=validate.Range(1, 100))
    worklog_project_required = fields.Boolean()
