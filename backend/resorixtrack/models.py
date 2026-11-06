# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""SQLAlchemy models.

All timestamps are stored as naive UTC in SQLite and exposed as timezone-aware UTC
datetimes through the ``UTCDateTime`` type decorator.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Time,
    TypeDecorator,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .extensions import db


def utcnow() -> datetime:
    from .timeutil import utcnow as _now

    return _now()


class UTCDateTime(TypeDecorator):
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime passed to UTCDateTime column")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC)


ROLE_ADMIN = "admin"
ROLE_EMPLOYEE = "employee"

WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
CAP_HR = "hr"
CAP_PROJECTS = "projects"
CAPABILITIES = (CAP_HR, CAP_PROJECTS)
LEAD_ROLES = ("lead", "deputy")


class User(db.Model):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(16), default=ROLE_EMPLOYEE)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)
    holiday_calendar_id: Mapped[int | None] = mapped_column(
        ForeignKey("holiday_calendars.id", ondelete="SET NULL"))
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Zurich")
    locale: Mapped[str] = mapped_column(String(16), default="en")
    employment_start: Mapped[date | None] = mapped_column(Date)
    employment_end: Mapped[date | None] = mapped_column(Date)
    vacation_days_per_year: Mapped[float] = mapped_column(Float, default=25.0)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    password_changed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # Two-factor authentication (TOTP): encrypted secret, activation time, hashed single-use recovery
    # codes, last accepted 30-second step (replay protection). See services/mfa.py.
    totp_secret: Mapped[str | None] = mapped_column(String(255))
    totp_enabled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    totp_recovery_codes: Mapped[list | None] = mapped_column(JSON)
    totp_last_step: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_email_on_correction: Mapped[bool] = mapped_column(Boolean, default=True)
    # Extra capabilities granted by administrators: "hr" (sees/signs off everyone's time data),
    # "projects" (manages all projects). Team leadership is a separate table (team_leads).
    capabilities: Mapped[list | None] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    team: Mapped[Team | None] = relationship(foreign_keys=[team_id], back_populates="members")
    holiday_calendar: Mapped[HolidayCalendar | None] = relationship()
    schedules: Mapped[list[WorkSchedule]] = relationship(
        back_populates="user", order_by="WorkSchedule.valid_from", cascade="all, delete-orphan")

    @property
    def is_admin(self) -> bool:
        """Administration: users, teams, roles, settings, holidays, branding, backups. Not time data."""
        return self.role == ROLE_ADMIN

    def has_cap(self, name: str) -> bool:
        return name in (self.capabilities or [])

    @property
    def is_hr(self) -> bool:
        """The HR capability sees and signs off everyone's time data (reports, sign-off, reopening)."""
        return self.has_cap(CAP_HR)

    @property
    def led_teams(self) -> list[Team]:
        from .services import permissions

        ids = permissions.led_team_ids(self)
        return db.session.scalars(db.select(Team).where(Team.id.in_(ids))).all() if ids else []

    @property
    def is_lead(self) -> bool:
        from .services import permissions

        return bool(permissions.led_team_ids(self))


class Team(db.Model):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    color: Mapped[str] = mapped_column(String(16), default="#35a1cc")
    holiday_calendar_id: Mapped[int | None] = mapped_column(
        ForeignKey("holiday_calendars.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    members: Mapped[list[User]] = relationship(foreign_keys=[User.team_id], back_populates="team")
    lead_rows: Mapped[list[TeamLead]] = relationship(back_populates="team", cascade="all, delete-orphan")
    holiday_calendar: Mapped[HolidayCalendar | None] = relationship()


class TeamLead(db.Model):
    """A team lead or a deputy (Stellvertreter) of a team, optionally limited to a period.
    Several people can lead a team; a deputy has the same powers while the period is current."""

    __tablename__ = "team_leads"
    __table_args__ = (Index("ix_team_leads_team_user", "team_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="lead")  # lead | deputy
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    team: Mapped[Team] = relationship(back_populates="lead_rows")
    user: Mapped[User] = relationship(foreign_keys=[user_id])

    def is_active_on(self, d: date) -> bool:
        return (self.valid_from is None or self.valid_from <= d) and (self.valid_to is None or self.valid_to >= d)


class WorkSchedule(db.Model):
    """Versioned contract data: valid from ``valid_from`` until the next schedule starts."""

    __tablename__ = "work_schedules"
    __table_args__ = (UniqueConstraint("user_id", "valid_from"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    valid_from: Mapped[date] = mapped_column(Date)
    pensum_percent: Mapped[float] = mapped_column(Float, default=100.0)
    minutes_mon: Mapped[int] = mapped_column(Integer, default=0)
    minutes_tue: Mapped[int] = mapped_column(Integer, default=0)
    minutes_wed: Mapped[int] = mapped_column(Integer, default=0)
    minutes_thu: Mapped[int] = mapped_column(Integer, default=0)
    minutes_fri: Mapped[int] = mapped_column(Integer, default=0)
    minutes_sat: Mapped[int] = mapped_column(Integer, default=0)
    minutes_sun: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    user: Mapped[User] = relationship(back_populates="schedules")

    def minutes_for(self, d: date) -> int:
        return getattr(self, f"minutes_{WEEKDAYS[d.weekday()]}")

    @property
    def weekly_minutes(self) -> int:
        return sum(getattr(self, f"minutes_{w}") for w in WEEKDAYS)

    def as_dict(self) -> dict[str, Any]:
        return {w: getattr(self, f"minutes_{w}") for w in WEEKDAYS}


class TimeEntry(db.Model):
    __tablename__ = "time_entries"
    __table_args__ = (
        Index("ix_time_entries_user_start", "user_id", "start_at"),
        # At most one running entry per user, even under concurrent clock-in requests.
        Index("uq_time_entries_open", "user_id", unique=True, sqlite_where=text("end_at IS NULL AND is_deleted = 0")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(8), default="work")  # work | break
    start_at: Mapped[datetime] = mapped_column(UTCDateTime)
    end_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    tz: Mapped[str] = mapped_column(String(64), default="Europe/Zurich")
    note: Mapped[str] = mapped_column(String(500), default="")
    source: Mapped[str] = mapped_column(String(16), default="clock")  # clock | manual | api | desktop
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(foreign_keys=[user_id])


class Revision(db.Model):
    """Immutable change log for all time-relevant data."""

    __tablename__ = "revisions"
    __table_args__ = (Index("ix_revisions_entity", "entity", "entity_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    entity: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[int] = mapped_column(Integer)
    subject_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(16))
    before: Mapped[dict | None] = mapped_column(JSON)
    after: Mapped[dict | None] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(String(500), default="")
    source: Mapped[str] = mapped_column(String(16), default="web")
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    actor: Mapped[User | None] = relationship(foreign_keys=[actor_id])


class HolidayCalendar(db.Model):
    __tablename__ = "holiday_calendars"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    region_code: Mapped[str] = mapped_column(String(32), default="")
    description: Mapped[str] = mapped_column(String(500), default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    holidays: Mapped[list[Holiday]] = relationship(
        back_populates="calendar", order_by="Holiday.date", cascade="all, delete-orphan")


class Holiday(db.Model):
    __tablename__ = "holidays"
    __table_args__ = (UniqueConstraint("calendar_id", "date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    calendar_id: Mapped[int] = mapped_column(ForeignKey("holiday_calendars.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date, index=True)
    name: Mapped[str] = mapped_column(String(120))
    fraction: Mapped[float] = mapped_column(Float, default=1.0)  # 1.0 full day, 0.5 half day

    calendar: Mapped[HolidayCalendar] = relationship(back_populates="holidays")


class AbsenceType(db.Model):
    __tablename__ = "absence_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(32), unique=True)
    label: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(16), default="#8a8d93")
    # vacation: workflow with approval + vacation account; sick: self-report rules; other
    category: Mapped[str] = mapped_column(String(16), default="other")
    credits_time: Mapped[bool] = mapped_column(Boolean, default=True)
    deducts_vacation: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    allows_attachments: Mapped[bool] = mapped_column(Boolean, default=False)
    employee_can_request: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=100)


ABSENCE_PENDING = "pending"
ABSENCE_APPROVED = "approved"
ABSENCE_REJECTED = "rejected"
ABSENCE_CANCELLED = "cancelled"
ABSENCE_ACTIVE_STATES = (ABSENCE_PENDING, ABSENCE_APPROVED)


class Absence(db.Model):
    __tablename__ = "absences"
    __table_args__ = (Index("ix_absences_user_dates", "user_id", "start_date", "end_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type_id: Mapped[int] = mapped_column(ForeignKey("absence_types.id"))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    # Single day: start_half in {full, am, pm}. Multi-day: start_half in {full, pm}, end_half in {full, am}.
    start_half: Mapped[str] = mapped_column(String(4), default="full")
    end_half: Mapped[str] = mapped_column(String(4), default="full")
    note: Mapped[str] = mapped_column(String(1000), default="")
    status: Mapped[str] = mapped_column(String(16), default=ABSENCE_PENDING, index=True)
    requested_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    decision_note: Mapped[str] = mapped_column(String(1000), default="")
    cancelled_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cancel_reason: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(foreign_keys=[user_id])
    type: Mapped[AbsenceType] = relationship()
    requested_by: Mapped[User | None] = relationship(foreign_keys=[requested_by_id])
    decided_by: Mapped[User | None] = relationship(foreign_keys=[decided_by_id])
    cancelled_by: Mapped[User | None] = relationship(foreign_keys=[cancelled_by_id])
    attachments: Mapped[list[Attachment]] = relationship(
        back_populates="absence", order_by="Attachment.created_at",
        primaryjoin="and_(Attachment.absence_id == Absence.id, Attachment.is_deleted == False)",  # noqa: E712
        viewonly=True)


class Attachment(db.Model):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    absence_id: Mapped[int] = mapped_column(ForeignKey("absences.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    storage_name: Mapped[str] = mapped_column(String(64), unique=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    absence: Mapped[Absence] = relationship(back_populates="attachments")
    uploaded_by: Mapped[User | None] = relationship()


class VacationEntitlement(db.Model):
    """Per-year override of ``User.vacation_days_per_year``."""

    __tablename__ = "vacation_entitlements"
    __table_args__ = (UniqueConstraint("user_id", "year"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    year: Mapped[int] = mapped_column(Integer)
    days: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(String(500), default="")


class BalanceAdjustment(db.Model):
    __tablename__ = "balance_adjustments"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    account: Mapped[str] = mapped_column(String(16))  # time (minutes) | vacation (days)
    amount: Mapped[float] = mapped_column(Float)
    effective_date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(16), default="correction")  # opening | payout | correction
    reason: Mapped[str] = mapped_column(String(500))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id])


class MonthSignoff(db.Model):
    """A month of one employee's time data, signed off by a team lead or admin.

    While active (``reopened_at IS NULL``) all time data of the user in the period is immutable.
    This is enforced by the services, by SQLite triggers (see ``db_guards``) and made tamper-evident
    by ``digest`` (fingerprint of the data) and ``seal`` (HMAC chained to the previous sign-off).
    """

    __tablename__ = "month_signoffs"
    __table_args__ = (
        Index("ix_month_signoffs_user_month", "user_id", "month"),
        Index("uq_month_signoffs_active", "user_id", "month", unique=True,
              sqlite_where=db.text("reopened_at IS NULL")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    month: Mapped[str] = mapped_column(String(7))  # YYYY-MM in the user's timezone
    period_start_date: Mapped[date] = mapped_column(Date)
    period_end_date: Mapped[date] = mapped_column(Date)
    period_start_utc: Mapped[datetime] = mapped_column(UTCDateTime)
    period_end_utc: Mapped[datetime] = mapped_column(UTCDateTime)  # exclusive
    signed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    signed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    note: Mapped[str] = mapped_column(String(500), default="")
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    digest: Mapped[str] = mapped_column(String(64))
    prev_seal: Mapped[str] = mapped_column(String(64), default="")
    seal: Mapped[str] = mapped_column(String(64))
    reopened_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    reopened_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reopen_reason: Mapped[str] = mapped_column(String(500), default="")

    user: Mapped[User] = relationship(foreign_keys=[user_id])
    signed_by: Mapped[User | None] = relationship(foreign_keys=[signed_by_id])
    reopened_by: Mapped[User | None] = relationship(foreign_keys=[reopened_by_id])


class Notification(db.Model):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ApiToken(db.Model):
    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    prefix: Mapped[str] = mapped_column(String(16))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    scopes: Mapped[str] = mapped_column(String(255), default="")
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # audit trail: where it was created / last used, how often, who revoked it
    created_ip: Mapped[str] = mapped_column(String(64), default="", server_default="")
    last_used_ip: Mapped[str] = mapped_column(String(64), default="", server_default="")
    use_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    revoked_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    user: Mapped[User] = relationship(foreign_keys=[user_id])


class AuthToken(db.Model):
    """One-time email tokens (invite / password reset)."""

    __tablename__ = "auth_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(16))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    user: Mapped[User] = relationship()


class UserSession(db.Model):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    remember: Mapped[bool] = mapped_column(Boolean, default=True)
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    user: Mapped[User] = relationship()


class LoginAttempt(db.Model):
    """Security log of every sign-in attempt (successful and failed). Also used for throttling."""

    __tablename__ = "login_attempts"
    __table_args__ = (Index("ix_login_attempts_email_at", "email", "at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="", server_default="")
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    # ok | invite | reset | setup | invalid_password | unknown_user | inactive | throttled | reset_requested
    reason: Mapped[str] = mapped_column(String(32), default="", server_default="")
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    user: Mapped[User | None] = relationship()


class Project(db.Model):
    """Something people book work on (customer, product, internal topic). Company-wide (team_id NULL)
    or owned by a team; team leads manage their team's projects, administrators all of them."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    code: Mapped[str] = mapped_column(String(30), default="")
    color: Mapped[str] = mapped_column(String(16), default="#35a1cc")
    description: Mapped[str] = mapped_column(String(500), default="")
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    team: Mapped[Team | None] = relationship()


class WorkLog(db.Model):
    """What a person did on a day: minutes spent, optional project, free text."""

    __tablename__ = "work_logs"
    __table_args__ = (Index("ix_work_logs_user_date", "user_id", "date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    minutes: Mapped[int] = mapped_column(Integer)
    # Optional exact times (local wall-clock of that day); when set, `minutes` is derived from them.
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    # Free-text alternative to a project, e.g. a customer number ("" when a project or nothing is referenced).
    customer_ref: Mapped[str] = mapped_column(String(60), default="")
    note: Mapped[str] = mapped_column(String(2000), default="")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(foreign_keys=[user_id])
    project: Mapped[Project | None] = relationship()


class Setting(db.Model):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)

