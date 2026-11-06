# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Database-level guards (SQLite triggers).

Second line of defence behind the service layer: even code that bypasses the services (a bug,
a script using the app's database connection) cannot change time data inside a signed-off month,
change or delete sign-off records, or rewrite the change log.

The same SQL is frozen in the initial migration (0001) for installations created from it; ``tests/test_signoffs.py``
asserts that both stay identical. Changing a guard requires a new migration.
"""

from __future__ import annotations

from sqlalchemy import event, text

from .extensions import db

ABORT = "SELECT RAISE(ABORT, 'resorixtrack: period signed off');"
ACTIVE = "s.reopened_at IS NULL"


def _entry_overlap(row: str) -> str:
    return (f"EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = {row}.user_id AND {ACTIVE} "
            f"AND {row}.start_at < s.period_end_utc "
            f"AND COALESCE({row}.end_at, '9999-12-31 00:00:00.000000') > s.period_start_utc)")


def _date_range_overlap(row: str, start: str, end: str) -> str:
    return (f"EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = {row}.user_id AND {ACTIVE} "
            f"AND {row}.{start} <= s.period_end_date AND {row}.{end} >= s.period_start_date)")


def _date_in(row: str, col: str) -> str:
    return (f"EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = {row}.user_id AND {ACTIVE} "
            f"AND {row}.{col} BETWEEN s.period_start_date AND s.period_end_date)")


def _date_on_or_before(row: str, col: str) -> str:
    return (f"EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = {row}.user_id AND {ACTIVE} "
            f"AND {row}.{col} <= s.period_end_date)")


def _trigger(name: str, timing: str, table: str, condition: str, message: str = ABORT) -> tuple[str, str]:
    return name, (f"CREATE TRIGGER IF NOT EXISTS {name} {timing} ON {table} FOR EACH ROW "
                  f"WHEN {condition} BEGIN {message} END")


IMMUTABLE_SIGNOFF = "SELECT RAISE(ABORT, 'resorixtrack: sign-offs are immutable');"
APPEND_ONLY = "SELECT RAISE(ABORT, 'resorixtrack: change log is append-only');"
LATEST_HOLIDAY_LOCK = ("(SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL)")

TRIGGERS: list[tuple[str, str]] = [
    # time entries
    _trigger("trg_signoff_time_entries_ins", "BEFORE INSERT", "time_entries", _entry_overlap("NEW")),
    _trigger("trg_signoff_time_entries_upd", "BEFORE UPDATE", "time_entries",
             f"{_entry_overlap('OLD')} OR {_entry_overlap('NEW')}"),
    _trigger("trg_signoff_time_entries_del", "BEFORE DELETE", "time_entries", _entry_overlap("OLD")),
    # absences
    _trigger("trg_signoff_absences_ins", "BEFORE INSERT", "absences", _date_range_overlap("NEW", "start_date", "end_date")),
    _trigger("trg_signoff_absences_upd", "BEFORE UPDATE", "absences",
             f"{_date_range_overlap('OLD', 'start_date', 'end_date')} OR "
             f"{_date_range_overlap('NEW', 'start_date', 'end_date')}"),
    _trigger("trg_signoff_absences_del", "BEFORE DELETE", "absences", _date_range_overlap("OLD", "start_date", "end_date")),
    # balance adjustments
    _trigger("trg_signoff_adjustments_ins", "BEFORE INSERT", "balance_adjustments", _date_in("NEW", "effective_date")),
    _trigger("trg_signoff_adjustments_upd", "BEFORE UPDATE", "balance_adjustments",
             f"{_date_in('OLD', 'effective_date')} OR {_date_in('NEW', 'effective_date')}"),
    _trigger("trg_signoff_adjustments_del", "BEFORE DELETE", "balance_adjustments", _date_in("OLD", "effective_date")),
    # work log (what was done on a day)
    _trigger("trg_signoff_work_logs_ins", "BEFORE INSERT", "work_logs", _date_in("NEW", "date")),
    _trigger("trg_signoff_work_logs_upd", "BEFORE UPDATE", "work_logs", f"{_date_in('OLD', 'date')} OR {_date_in('NEW', 'date')}"),
    _trigger("trg_signoff_work_logs_del", "BEFORE DELETE", "work_logs", _date_in("OLD", "date")),
    # work schedules (a version starting on/before a signed month changes its target)
    _trigger("trg_signoff_schedules_ins", "BEFORE INSERT", "work_schedules", _date_on_or_before("NEW", "valid_from")),
    _trigger("trg_signoff_schedules_upd", "BEFORE UPDATE", "work_schedules",
             f"{_date_on_or_before('OLD', 'valid_from')} OR {_date_on_or_before('NEW', 'valid_from')}"),
    _trigger("trg_signoff_schedules_del", "BEFORE DELETE", "work_schedules", _date_on_or_before("OLD", "valid_from")),
    # employment dates of a user
    _trigger("trg_signoff_users_employment", "BEFORE UPDATE OF employment_start, employment_end", "users",
             "(OLD.employment_start IS NOT NEW.employment_start OR OLD.employment_end IS NOT NEW.employment_end) "
             "AND EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.id AND s.reopened_at IS NULL AND "
             "MIN(COALESCE(OLD.employment_start, '0001-01-01'), COALESCE(NEW.employment_start, '0001-01-01'), "
             "COALESCE(OLD.employment_end, '9999-12-31'), COALESCE(NEW.employment_end, '9999-12-31')) "
             "<= s.period_end_date)"),
    # public holidays on or before the latest signed-off period (affects targets of signed months)
    _trigger("trg_signoff_holidays_ins", "BEFORE INSERT", "holidays", f"NEW.date <= {LATEST_HOLIDAY_LOCK}"),
    _trigger("trg_signoff_holidays_upd", "BEFORE UPDATE", "holidays",
             f"OLD.date <= {LATEST_HOLIDAY_LOCK} OR NEW.date <= {LATEST_HOLIDAY_LOCK}"),
    _trigger("trg_signoff_holidays_del", "BEFORE DELETE", "holidays", f"OLD.date <= {LATEST_HOLIDAY_LOCK}"),
    # sign-off records: only a single reopen is allowed, never deletion or edits
    _trigger("trg_signoffs_no_delete", "BEFORE DELETE", "month_signoffs", "1", IMMUTABLE_SIGNOFF),
    _trigger("trg_signoffs_immutable", "BEFORE UPDATE", "month_signoffs",
             "OLD.reopened_at IS NOT NULL OR NEW.reopened_at IS NULL OR NEW.user_id IS NOT OLD.user_id "
             "OR NEW.month IS NOT OLD.month OR NEW.period_start_date IS NOT OLD.period_start_date "
             "OR NEW.period_end_date IS NOT OLD.period_end_date OR NEW.period_start_utc IS NOT OLD.period_start_utc "
             "OR NEW.period_end_utc IS NOT OLD.period_end_utc OR NEW.signed_by_id IS NOT OLD.signed_by_id "
             "OR NEW.signed_at IS NOT OLD.signed_at OR NEW.snapshot IS NOT OLD.snapshot "
             "OR NEW.digest IS NOT OLD.digest OR NEW.seal IS NOT OLD.seal OR NEW.prev_seal IS NOT OLD.prev_seal",
             IMMUTABLE_SIGNOFF),
    # change log is append-only
    _trigger("trg_revisions_no_update", "BEFORE UPDATE", "revisions", "1", APPEND_ONLY),
    _trigger("trg_revisions_no_delete", "BEFORE DELETE", "revisions", "1", APPEND_ONLY),
]


def install(connection) -> None:
    if connection.dialect.name != "sqlite":  # pragma: no cover
        return
    for _name, sql in TRIGGERS:
        connection.execute(text(sql))


def installed(connection) -> dict[str, str]:
    rows = connection.execute(text("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'"))
    return {r[0]: r[1] for r in rows}


@event.listens_for(db.metadata, "after_create")
def _after_create(target, connection, **kw):  # used by db.create_all() (tests, fresh dev DBs)
    install(connection)


def is_guard_error(exc: BaseException) -> str | None:
    msg = str(getattr(exc, "orig", exc))
    for marker, code in (("resorixtrack: period signed off", "period_signed_off"),
                         ("resorixtrack: sign-offs are immutable", "signoff_immutable"),
                         ("resorixtrack: change log is append-only", "revisions_append_only")):
        if marker in msg:
            return code
    return None
