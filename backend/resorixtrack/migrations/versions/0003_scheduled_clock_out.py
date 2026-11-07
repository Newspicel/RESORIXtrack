"""scheduled clock-out; breaks are clock-outs

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-07 09:00:00

Adds ``time_entries.scheduled_end_at`` ("clock out later"). The separate pause state was removed: a break
is simply a clock-out, the gap between two work entries. Legacy break entries are retired the way a person
deletes an entry (``is_deleted``, with a revision row), except inside signed-off months, which stay
immutable (the database guards would refuse the update anyway). The column is added in place, so the
guard triggers on ``time_entries`` are untouched.
"""
import json
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None

# Legacy break entries outside signed-off months (the condition mirrors the guard triggers).
LEGACY_BREAKS = ("SELECT e.id, e.user_id, e.kind, e.start_at, e.end_at, e.tz, e.note, e.source FROM time_entries e "
                 "WHERE e.kind = 'break' AND e.is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM month_signoffs s "
                 "WHERE s.user_id = e.user_id AND s.reopened_at IS NULL AND e.start_at < s.period_end_utc "
                 "AND COALESCE(e.end_at, '9999-12-31 00:00:00.000000') > s.period_start_utc)")
REASON = "Pauses were removed from RESORIXtrack: a break is a clock-out (migration 0003)"


def _iso(value):
    """SQLite stores naive UTC timestamps; revisions keep ISO 8601 with offset, like the app does."""
    if value is None:
        return None
    return datetime.fromisoformat(str(value).replace(" ", "T")).replace(tzinfo=UTC).isoformat()


def upgrade():
    with op.batch_alter_table('time_entries', schema=None) as batch_op:
        batch_op.add_column(sa.Column('scheduled_end_at', sa.DateTime(), nullable=True))

    conn = op.get_bind()
    now_dt = datetime.now(UTC).replace(tzinfo=None)
    now = now_dt.strftime("%Y-%m-%d %H:%M:%S.%f")  # the storage format of the DateTime columns (bound as text)
    rows = conn.execute(sa.text(LEGACY_BREAKS)).fetchall()
    for r in rows:
        before = {"kind": r.kind, "start_at": _iso(r.start_at), "end_at": _iso(r.end_at), "scheduled_end_at": None,
                  "tz": r.tz, "note": r.note, "source": r.source, "is_deleted": False}
        after = dict(before, is_deleted=True)
        if after["end_at"] is None:  # someone was "on a break" during the upgrade: the break ends now
            after["end_at"] = now_dt.replace(tzinfo=UTC).isoformat()
        conn.execute(sa.text("UPDATE time_entries SET is_deleted = 1, end_at = COALESCE(end_at, :now), "
                             "updated_at = :now WHERE id = :id"), {"id": r.id, "now": now})
        conn.execute(sa.text(
            "INSERT INTO revisions (entity, entity_id, subject_user_id, actor_id, action, before, after, reason, "
            "source, at) VALUES ('time_entry', :id, :uid, NULL, 'delete', :before, :after, :reason, 'migration', :now)"),
            {"id": r.id, "uid": r.user_id, "before": json.dumps(before), "after": json.dumps(after),
             "reason": REASON, "now": now})


def downgrade():
    # Retired break entries stay retired (their revisions say why). Dropping a column recreates the table
    # on SQLite; `flask resorixtrack migrate` reinstalls any guard trigger that is missing afterwards.
    with op.batch_alter_table('time_entries', schema=None) as batch_op:
        batch_op.drop_column('scheduled_end_at')
