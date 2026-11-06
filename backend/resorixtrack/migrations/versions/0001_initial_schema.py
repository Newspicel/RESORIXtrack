# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-11-06

The complete RESORIXtrack schema. It also installs the database guards (SQLite triggers that protect
signed-off months, sign-off records and the append-only change log); they are frozen here and must
stay identical to resorixtrack/db_guards.py (tests/test_signoffs.py checks that). Changing a guard
requires a new migration.
"""
from alembic import op
import sqlalchemy as sa

# Database guards, frozen at this revision. Keep in sync with resorixtrack/db_guards.py.
TRIGGERS = [('trg_signoff_time_entries_ins',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_time_entries_ins BEFORE INSERT ON time_entries FOR EACH ROW WHEN '
  'EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND '
  "NEW.start_at < s.period_end_utc AND COALESCE(NEW.end_at, '9999-12-31 00:00:00.000000') > "
  "s.period_start_utc) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END"),
 ('trg_signoff_time_entries_upd',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_time_entries_upd BEFORE UPDATE ON time_entries FOR EACH ROW WHEN '
  'EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND '
  "OLD.start_at < s.period_end_utc AND COALESCE(OLD.end_at, '9999-12-31 00:00:00.000000') > "
  's.period_start_utc) OR EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND '
  "s.reopened_at IS NULL AND NEW.start_at < s.period_end_utc AND COALESCE(NEW.end_at, '9999-12-31 "
  "00:00:00.000000') > s.period_start_utc) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END"),
 ('trg_signoff_time_entries_del',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_time_entries_del BEFORE DELETE ON time_entries FOR EACH ROW WHEN '
  'EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND '
  "OLD.start_at < s.period_end_utc AND COALESCE(OLD.end_at, '9999-12-31 00:00:00.000000') > "
  "s.period_start_utc) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END"),
 ('trg_signoff_absences_ins',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_absences_ins BEFORE INSERT ON absences FOR EACH ROW WHEN EXISTS '
  '(SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND '
  'NEW.start_date <= s.period_end_date AND NEW.end_date >= s.period_start_date) BEGIN SELECT RAISE(ABORT, '
  "'resorixtrack: period signed off'); END"),
 ('trg_signoff_absences_upd',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_absences_upd BEFORE UPDATE ON absences FOR EACH ROW WHEN EXISTS '
  '(SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND '
  'OLD.start_date <= s.period_end_date AND OLD.end_date >= s.period_start_date) OR EXISTS (SELECT 1 FROM '
  'month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.start_date <= '
  "s.period_end_date AND NEW.end_date >= s.period_start_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period "
  "signed off'); END"),
 ('trg_signoff_absences_del',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_absences_del BEFORE DELETE ON absences FOR EACH ROW WHEN EXISTS '
  '(SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND '
  'OLD.start_date <= s.period_end_date AND OLD.end_date >= s.period_start_date) BEGIN SELECT RAISE(ABORT, '
  "'resorixtrack: period signed off'); END"),
 ('trg_signoff_adjustments_ins',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_adjustments_ins BEFORE INSERT ON balance_adjustments FOR EACH '
  'ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL '
  'AND NEW.effective_date BETWEEN s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, '
  "'resorixtrack: period signed off'); END"),
 ('trg_signoff_adjustments_upd',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_adjustments_upd BEFORE UPDATE ON balance_adjustments FOR EACH '
  'ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL '
  'AND OLD.effective_date BETWEEN s.period_start_date AND s.period_end_date) OR EXISTS (SELECT 1 FROM '
  'month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.effective_date BETWEEN '
  "s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); "
  'END'),
 ('trg_signoff_adjustments_del',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_adjustments_del BEFORE DELETE ON balance_adjustments FOR EACH '
  'ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL '
  'AND OLD.effective_date BETWEEN s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, '
  "'resorixtrack: period signed off'); END"),
 ('trg_signoff_work_logs_ins',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_work_logs_ins BEFORE INSERT ON work_logs FOR EACH ROW WHEN '
  'EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND '
  "NEW.date BETWEEN s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period "
  "signed off'); END"),
 ('trg_signoff_work_logs_upd',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_work_logs_upd BEFORE UPDATE ON work_logs FOR EACH ROW WHEN '
  'EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND '
  'OLD.date BETWEEN s.period_start_date AND s.period_end_date) OR EXISTS (SELECT 1 FROM month_signoffs s '
  'WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.date BETWEEN s.period_start_date AND '
  "s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END"),
 ('trg_signoff_work_logs_del',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_work_logs_del BEFORE DELETE ON work_logs FOR EACH ROW WHEN '
  'EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND '
  "OLD.date BETWEEN s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period "
  "signed off'); END"),
 ('trg_signoff_schedules_ins',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_schedules_ins BEFORE INSERT ON work_schedules FOR EACH ROW WHEN '
  'EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND '
  "NEW.valid_from <= s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END"),
 ('trg_signoff_schedules_upd',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_schedules_upd BEFORE UPDATE ON work_schedules FOR EACH ROW WHEN '
  'EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND '
  'OLD.valid_from <= s.period_end_date) OR EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = '
  'NEW.user_id AND s.reopened_at IS NULL AND NEW.valid_from <= s.period_end_date) BEGIN SELECT RAISE(ABORT, '
  "'resorixtrack: period signed off'); END"),
 ('trg_signoff_schedules_del',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_schedules_del BEFORE DELETE ON work_schedules FOR EACH ROW WHEN '
  'EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND '
  "OLD.valid_from <= s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END"),
 ('trg_signoff_users_employment',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_users_employment BEFORE UPDATE OF employment_start, '
  'employment_end ON users FOR EACH ROW WHEN (OLD.employment_start IS NOT NEW.employment_start OR '
  'OLD.employment_end IS NOT NEW.employment_end) AND EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id '
  "= OLD.id AND s.reopened_at IS NULL AND MIN(COALESCE(OLD.employment_start, '0001-01-01'), "
  "COALESCE(NEW.employment_start, '0001-01-01'), COALESCE(OLD.employment_end, '9999-12-31'), "
  "COALESCE(NEW.employment_end, '9999-12-31')) <= s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: "
  "period signed off'); END"),
 ('trg_signoff_holidays_ins',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_holidays_ins BEFORE INSERT ON holidays FOR EACH ROW WHEN '
  'NEW.date <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN '
  "SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END"),
 ('trg_signoff_holidays_upd',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_holidays_upd BEFORE UPDATE ON holidays FOR EACH ROW WHEN '
  'OLD.date <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) OR NEW.date '
  '<= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN SELECT '
  "RAISE(ABORT, 'resorixtrack: period signed off'); END"),
 ('trg_signoff_holidays_del',
  'CREATE TRIGGER IF NOT EXISTS trg_signoff_holidays_del BEFORE DELETE ON holidays FOR EACH ROW WHEN '
  'OLD.date <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN '
  "SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END"),
 ('trg_signoffs_no_delete',
  'CREATE TRIGGER IF NOT EXISTS trg_signoffs_no_delete BEFORE DELETE ON month_signoffs FOR EACH ROW WHEN 1 '
  "BEGIN SELECT RAISE(ABORT, 'resorixtrack: sign-offs are immutable'); END"),
 ('trg_signoffs_immutable',
  'CREATE TRIGGER IF NOT EXISTS trg_signoffs_immutable BEFORE UPDATE ON month_signoffs FOR EACH ROW WHEN '
  'OLD.reopened_at IS NOT NULL OR NEW.reopened_at IS NULL OR NEW.user_id IS NOT OLD.user_id OR NEW.month IS '
  'NOT OLD.month OR NEW.period_start_date IS NOT OLD.period_start_date OR NEW.period_end_date IS NOT '
  'OLD.period_end_date OR NEW.period_start_utc IS NOT OLD.period_start_utc OR NEW.period_end_utc IS NOT '
  'OLD.period_end_utc OR NEW.signed_by_id IS NOT OLD.signed_by_id OR NEW.signed_at IS NOT OLD.signed_at OR '
  'NEW.snapshot IS NOT OLD.snapshot OR NEW.digest IS NOT OLD.digest OR NEW.seal IS NOT OLD.seal OR '
  "NEW.prev_seal IS NOT OLD.prev_seal BEGIN SELECT RAISE(ABORT, 'resorixtrack: sign-offs are immutable'); END"),
 ('trg_revisions_no_update',
  'CREATE TRIGGER IF NOT EXISTS trg_revisions_no_update BEFORE UPDATE ON revisions FOR EACH ROW WHEN 1 BEGIN '
  "SELECT RAISE(ABORT, 'resorixtrack: change log is append-only'); END"),
 ('trg_revisions_no_delete',
  'CREATE TRIGGER IF NOT EXISTS trg_revisions_no_delete BEFORE DELETE ON revisions FOR EACH ROW WHEN 1 BEGIN '
  "SELECT RAISE(ABORT, 'resorixtrack: change log is append-only'); END")]

# revision identifiers, used by Alembic.
revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('absence_types',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('key', sa.String(length=32), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('color', sa.String(length=16), nullable=False),
    sa.Column('category', sa.String(length=16), nullable=False),
    sa.Column('credits_time', sa.Boolean(), nullable=False),
    sa.Column('deducts_vacation', sa.Boolean(), nullable=False),
    sa.Column('requires_approval', sa.Boolean(), nullable=False),
    sa.Column('allows_attachments', sa.Boolean(), nullable=False),
    sa.Column('employee_can_request', sa.Boolean(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('sort', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_absence_types')),
    sa.UniqueConstraint('key', name=op.f('uq_absence_types_key'))
    )
    op.create_table('holiday_calendars',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('region_code', sa.String(length=32), nullable=False),
    sa.Column('description', sa.String(length=500), nullable=False),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_holiday_calendars')),
    sa.UniqueConstraint('name', name=op.f('uq_holiday_calendars_name'))
    )
    op.create_table('settings',
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('value', sa.JSON(), nullable=False),
    sa.PrimaryKeyConstraint('key', name=op.f('pk_settings'))
    )
    op.create_table('holidays',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('calendar_id', sa.Integer(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('fraction', sa.Float(), nullable=False),
    sa.ForeignKeyConstraint(['calendar_id'], ['holiday_calendars.id'], name=op.f('fk_holidays_calendar_id_holiday_calendars'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_holidays')),
    sa.UniqueConstraint('calendar_id', 'date', name=op.f('uq_holidays_calendar_id'))
    )
    with op.batch_alter_table('holidays', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_holidays_date'), ['date'], unique=False)

    op.create_table('teams',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('color', sa.String(length=16), nullable=False),
    sa.Column('holiday_calendar_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['holiday_calendar_id'], ['holiday_calendars.id'], name=op.f('fk_teams_holiday_calendar_id_holiday_calendars'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_teams')),
    sa.UniqueConstraint('name', name=op.f('uq_teams_name'))
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('team_id', sa.Integer(), nullable=True),
    sa.Column('holiday_calendar_id', sa.Integer(), nullable=True),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('locale', sa.String(length=16), nullable=False),
    sa.Column('employment_start', sa.Date(), nullable=True),
    sa.Column('employment_end', sa.Date(), nullable=True),
    sa.Column('vacation_days_per_year', sa.Float(), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=True),
    sa.Column('password_changed_at', sa.DateTime(), nullable=True),
    sa.Column('totp_secret', sa.String(length=255), nullable=True),
    sa.Column('totp_enabled_at', sa.DateTime(), nullable=True),
    sa.Column('totp_recovery_codes', sa.JSON(), nullable=True),
    sa.Column('totp_last_step', sa.Integer(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('notify_email_on_correction', sa.Boolean(), nullable=False),
    sa.Column('capabilities', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('last_login_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['holiday_calendar_id'], ['holiday_calendars.id'], name=op.f('fk_users_holiday_calendar_id_holiday_calendars'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('fk_users_team_id_teams'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users'))
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)
        batch_op.create_index(batch_op.f('ix_users_team_id'), ['team_id'], unique=False)

    op.create_table('absences',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('type_id', sa.Integer(), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=False),
    sa.Column('start_half', sa.String(length=4), nullable=False),
    sa.Column('end_half', sa.String(length=4), nullable=False),
    sa.Column('note', sa.String(length=1000), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('requested_by_id', sa.Integer(), nullable=True),
    sa.Column('decided_by_id', sa.Integer(), nullable=True),
    sa.Column('decided_at', sa.DateTime(), nullable=True),
    sa.Column('decision_note', sa.String(length=1000), nullable=False),
    sa.Column('cancelled_by_id', sa.Integer(), nullable=True),
    sa.Column('cancelled_at', sa.DateTime(), nullable=True),
    sa.Column('cancel_reason', sa.String(length=1000), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['cancelled_by_id'], ['users.id'], name=op.f('fk_absences_cancelled_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['decided_by_id'], ['users.id'], name=op.f('fk_absences_decided_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['requested_by_id'], ['users.id'], name=op.f('fk_absences_requested_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['type_id'], ['absence_types.id'], name=op.f('fk_absences_type_id_absence_types')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_absences_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_absences'))
    )
    with op.batch_alter_table('absences', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_absences_status'), ['status'], unique=False)
        batch_op.create_index('ix_absences_user_dates', ['user_id', 'start_date', 'end_date'], unique=False)

    op.create_table('api_tokens',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('prefix', sa.String(length=16), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('scopes', sa.String(length=255), nullable=False),
    sa.Column('last_used_at', sa.DateTime(), nullable=True),
    sa.Column('created_ip', sa.String(length=64), server_default='', nullable=False),
    sa.Column('last_used_ip', sa.String(length=64), server_default='', nullable=False),
    sa.Column('use_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=True),
    sa.Column('revoked_at', sa.DateTime(), nullable=True),
    sa.Column('revoked_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['revoked_by_id'], ['users.id'], name=op.f('fk_api_tokens_revoked_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_api_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_api_tokens')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_api_tokens_token_hash'))
    )
    with op.batch_alter_table('api_tokens', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_api_tokens_user_id'), ['user_id'], unique=False)

    op.create_table('auth_tokens',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('purpose', sa.String(length=16), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('used_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_auth_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_auth_tokens')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_auth_tokens_token_hash'))
    )
    with op.batch_alter_table('auth_tokens', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_auth_tokens_user_id'), ['user_id'], unique=False)

    op.create_table('balance_adjustments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('account', sa.String(length=16), nullable=False),
    sa.Column('amount', sa.Float(), nullable=False),
    sa.Column('effective_date', sa.Date(), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('reason', sa.String(length=500), nullable=False),
    sa.Column('is_deleted', sa.Boolean(), nullable=False),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_balance_adjustments_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_balance_adjustments_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_balance_adjustments'))
    )
    with op.batch_alter_table('balance_adjustments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_balance_adjustments_user_id'), ['user_id'], unique=False)

    op.create_table('login_attempts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('ip', sa.String(length=64), nullable=False),
    sa.Column('user_agent', sa.String(length=300), server_default='', nullable=False),
    sa.Column('success', sa.Boolean(), nullable=False),
    sa.Column('reason', sa.String(length=32), server_default='', nullable=False),
    sa.Column('at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_login_attempts_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_login_attempts'))
    )
    with op.batch_alter_table('login_attempts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_login_attempts_at'), ['at'], unique=False)
        batch_op.create_index('ix_login_attempts_email_at', ['email', 'at'], unique=False)
        batch_op.create_index(batch_op.f('ix_login_attempts_user_id'), ['user_id'], unique=False)

    op.create_table('month_signoffs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('month', sa.String(length=7), nullable=False),
    sa.Column('period_start_date', sa.Date(), nullable=False),
    sa.Column('period_end_date', sa.Date(), nullable=False),
    sa.Column('period_start_utc', sa.DateTime(), nullable=False),
    sa.Column('period_end_utc', sa.DateTime(), nullable=False),
    sa.Column('signed_by_id', sa.Integer(), nullable=True),
    sa.Column('signed_at', sa.DateTime(), nullable=False),
    sa.Column('note', sa.String(length=500), nullable=False),
    sa.Column('snapshot', sa.JSON(), nullable=False),
    sa.Column('digest', sa.String(length=64), nullable=False),
    sa.Column('prev_seal', sa.String(length=64), nullable=False),
    sa.Column('seal', sa.String(length=64), nullable=False),
    sa.Column('reopened_at', sa.DateTime(), nullable=True),
    sa.Column('reopened_by_id', sa.Integer(), nullable=True),
    sa.Column('reopen_reason', sa.String(length=500), nullable=False),
    sa.ForeignKeyConstraint(['reopened_by_id'], ['users.id'], name=op.f('fk_month_signoffs_reopened_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['signed_by_id'], ['users.id'], name=op.f('fk_month_signoffs_signed_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_month_signoffs_user_id_users'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_month_signoffs'))
    )
    with op.batch_alter_table('month_signoffs', schema=None) as batch_op:
        batch_op.create_index('ix_month_signoffs_user_month', ['user_id', 'month'], unique=False)
        batch_op.create_index('uq_month_signoffs_active', ['user_id', 'month'], unique=True, sqlite_where=sa.text('reopened_at IS NULL'))

    op.create_table('notifications',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('read_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_notifications_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_notifications'))
    )
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_notifications_user_id'), ['user_id'], unique=False)

    op.create_table('projects',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('code', sa.String(length=30), nullable=False),
    sa.Column('color', sa.String(length=16), nullable=False),
    sa.Column('description', sa.String(length=500), nullable=False),
    sa.Column('team_id', sa.Integer(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_projects_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('fk_projects_team_id_teams'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_projects')),
    sa.UniqueConstraint('name', name=op.f('uq_projects_name'))
    )
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_projects_team_id'), ['team_id'], unique=False)

    op.create_table('revisions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('entity', sa.String(length=32), nullable=False),
    sa.Column('entity_id', sa.Integer(), nullable=False),
    sa.Column('subject_user_id', sa.Integer(), nullable=True),
    sa.Column('actor_id', sa.Integer(), nullable=True),
    sa.Column('action', sa.String(length=16), nullable=False),
    sa.Column('before', sa.JSON(), nullable=True),
    sa.Column('after', sa.JSON(), nullable=True),
    sa.Column('reason', sa.String(length=500), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_revisions_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['subject_user_id'], ['users.id'], name=op.f('fk_revisions_subject_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_revisions'))
    )
    with op.batch_alter_table('revisions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_revisions_at'), ['at'], unique=False)
        batch_op.create_index('ix_revisions_entity', ['entity', 'entity_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_revisions_subject_user_id'), ['subject_user_id'], unique=False)

    op.create_table('team_leads',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('team_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('valid_from', sa.Date(), nullable=True),
    sa.Column('valid_to', sa.Date(), nullable=True),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_team_leads_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('fk_team_leads_team_id_teams'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_team_leads_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_team_leads'))
    )
    with op.batch_alter_table('team_leads', schema=None) as batch_op:
        batch_op.create_index('ix_team_leads_team_user', ['team_id', 'user_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_team_leads_user_id'), ['user_id'], unique=False)

    op.create_table('time_entries',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=8), nullable=False),
    sa.Column('start_at', sa.DateTime(), nullable=False),
    sa.Column('end_at', sa.DateTime(), nullable=True),
    sa.Column('tz', sa.String(length=64), nullable=False),
    sa.Column('note', sa.String(length=500), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('is_deleted', sa.Boolean(), nullable=False),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_time_entries_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_time_entries_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_time_entries'))
    )
    with op.batch_alter_table('time_entries', schema=None) as batch_op:
        batch_op.create_index('ix_time_entries_user_start', ['user_id', 'start_at'], unique=False)
        batch_op.create_index('uq_time_entries_open', ['user_id'], unique=True, sqlite_where=sa.text('end_at IS NULL AND is_deleted = 0'))

    op.create_table('user_sessions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('csrf_token', sa.String(length=64), nullable=False),
    sa.Column('remember', sa.Boolean(), nullable=False),
    sa.Column('user_agent', sa.String(length=300), nullable=False),
    sa.Column('ip', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('revoked_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_sessions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_sessions')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_user_sessions_token_hash'))
    )
    with op.batch_alter_table('user_sessions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_user_sessions_user_id'), ['user_id'], unique=False)

    op.create_table('vacation_entitlements',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('days', sa.Float(), nullable=False),
    sa.Column('note', sa.String(length=500), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_vacation_entitlements_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_vacation_entitlements')),
    sa.UniqueConstraint('user_id', 'year', name=op.f('uq_vacation_entitlements_user_id'))
    )
    op.create_table('work_schedules',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('valid_from', sa.Date(), nullable=False),
    sa.Column('pensum_percent', sa.Float(), nullable=False),
    sa.Column('minutes_mon', sa.Integer(), nullable=False),
    sa.Column('minutes_tue', sa.Integer(), nullable=False),
    sa.Column('minutes_wed', sa.Integer(), nullable=False),
    sa.Column('minutes_thu', sa.Integer(), nullable=False),
    sa.Column('minutes_fri', sa.Integer(), nullable=False),
    sa.Column('minutes_sat', sa.Integer(), nullable=False),
    sa.Column('minutes_sun', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_work_schedules_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_work_schedules')),
    sa.UniqueConstraint('user_id', 'valid_from', name=op.f('uq_work_schedules_user_id'))
    )
    with op.batch_alter_table('work_schedules', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_work_schedules_user_id'), ['user_id'], unique=False)

    op.create_table('attachments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('absence_id', sa.Integer(), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('content_type', sa.String(length=100), nullable=False),
    sa.Column('size', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('storage_name', sa.String(length=64), nullable=False),
    sa.Column('uploaded_by_id', sa.Integer(), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['absence_id'], ['absences.id'], name=op.f('fk_attachments_absence_id_absences'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['uploaded_by_id'], ['users.id'], name=op.f('fk_attachments_uploaded_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_attachments')),
    sa.UniqueConstraint('storage_name', name=op.f('uq_attachments_storage_name'))
    )
    with op.batch_alter_table('attachments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_attachments_absence_id'), ['absence_id'], unique=False)

    op.create_table('work_logs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=True),
    sa.Column('minutes', sa.Integer(), nullable=False),
    sa.Column('start_time', sa.Time(), nullable=True),
    sa.Column('end_time', sa.Time(), nullable=True),
    sa.Column('customer_ref', sa.String(length=60), nullable=False),
    sa.Column('note', sa.String(length=2000), nullable=False),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_work_logs_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_work_logs_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_work_logs_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_work_logs'))
    )
    with op.batch_alter_table('work_logs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_work_logs_project_id'), ['project_id'], unique=False)
        batch_op.create_index('ix_work_logs_user_date', ['user_id', 'date'], unique=False)

    # ### end Alembic commands ###
    for _name, sql in TRIGGERS:
        op.execute(sql)


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    for name, _sql in TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name}")
    with op.batch_alter_table('work_logs', schema=None) as batch_op:
        batch_op.drop_index('ix_work_logs_user_date')
        batch_op.drop_index(batch_op.f('ix_work_logs_project_id'))

    op.drop_table('work_logs')
    with op.batch_alter_table('attachments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_attachments_absence_id'))

    op.drop_table('attachments')
    with op.batch_alter_table('work_schedules', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_work_schedules_user_id'))

    op.drop_table('work_schedules')
    op.drop_table('vacation_entitlements')
    with op.batch_alter_table('user_sessions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_user_sessions_user_id'))

    op.drop_table('user_sessions')
    with op.batch_alter_table('time_entries', schema=None) as batch_op:
        batch_op.drop_index('uq_time_entries_open', sqlite_where=sa.text('end_at IS NULL AND is_deleted = 0'))
        batch_op.drop_index('ix_time_entries_user_start')

    op.drop_table('time_entries')
    with op.batch_alter_table('team_leads', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_team_leads_user_id'))
        batch_op.drop_index('ix_team_leads_team_user')

    op.drop_table('team_leads')
    with op.batch_alter_table('revisions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_revisions_subject_user_id'))
        batch_op.drop_index('ix_revisions_entity')
        batch_op.drop_index(batch_op.f('ix_revisions_at'))

    op.drop_table('revisions')
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_projects_team_id'))

    op.drop_table('projects')
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_notifications_user_id'))

    op.drop_table('notifications')
    with op.batch_alter_table('month_signoffs', schema=None) as batch_op:
        batch_op.drop_index('uq_month_signoffs_active', sqlite_where=sa.text('reopened_at IS NULL'))
        batch_op.drop_index('ix_month_signoffs_user_month')

    op.drop_table('month_signoffs')
    with op.batch_alter_table('login_attempts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_login_attempts_user_id'))
        batch_op.drop_index('ix_login_attempts_email_at')
        batch_op.drop_index(batch_op.f('ix_login_attempts_at'))

    op.drop_table('login_attempts')
    with op.batch_alter_table('balance_adjustments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_balance_adjustments_user_id'))

    op.drop_table('balance_adjustments')
    with op.batch_alter_table('auth_tokens', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_auth_tokens_user_id'))

    op.drop_table('auth_tokens')
    with op.batch_alter_table('api_tokens', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_api_tokens_user_id'))

    op.drop_table('api_tokens')
    with op.batch_alter_table('absences', schema=None) as batch_op:
        batch_op.drop_index('ix_absences_user_dates')
        batch_op.drop_index(batch_op.f('ix_absences_status'))

    op.drop_table('absences')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_team_id'))
        batch_op.drop_index(batch_op.f('ix_users_email'))

    op.drop_table('users')
    op.drop_table('teams')
    with op.batch_alter_table('holidays', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_holidays_date'))

    op.drop_table('holidays')
    op.drop_table('settings')
    op.drop_table('holiday_calendars')
    op.drop_table('absence_types')
    # ### end Alembic commands ###
