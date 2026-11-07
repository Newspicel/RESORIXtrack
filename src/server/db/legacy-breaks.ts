/**
 * A break is simply a clock-out. Legacy break entries (1.x data, or a 2.x database seeded before the pause
 * state was removed) are retired the way a person deletes an entry: soft-deleted, each with a revision row.
 * Entries inside signed-off months stay as they are (immutable). Same statements as migration 0006; the
 * v1 importer runs them too, because the target database was migrated before the rows were copied.
 */
import type Database from "better-sqlite3"

const NOW = "strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'"
const OPEN = `NOT EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = e.user_id AND s.reopened_at IS NULL
  AND e.start_at < s.period_end_utc AND COALESCE(e.end_at, '9999-12-31T00:00:00.000000Z') > s.period_start_utc)`

export const LEGACY_BREAK_REASON = "Pauses were removed from RESORIXtrack: a break is a clock-out (migration 0006)"

/** Retires open legacy break rows; returns how many. Run inside a transaction. */
export function retireLegacyBreaks(sqlite: Database.Database): number {
  sqlite
    .prepare(
      `INSERT INTO revisions (entity, entity_id, subject_user_id, actor_id, action, before, after, reason, source, at)
       SELECT 'time_entry', e.id, e.user_id, NULL, 'delete',
         json_object('kind', e.kind, 'start_at', e.start_at, 'end_at', e.end_at, 'scheduled_end_at', NULL, 'tz', e.tz,
                     'note', e.note, 'source', e.source, 'is_deleted', json('false')),
         json_object('kind', e.kind, 'start_at', e.start_at, 'end_at', COALESCE(e.end_at, ${NOW}), 'scheduled_end_at', NULL,
                     'tz', e.tz, 'note', e.note, 'source', e.source, 'is_deleted', json('true')),
         ?, 'migration', ${NOW}
       FROM time_entries e WHERE e.kind = 'break' AND e.is_deleted = 0 AND ${OPEN}`,
    )
    .run(LEGACY_BREAK_REASON)
  return sqlite
    .prepare(
      `UPDATE time_entries SET is_deleted = 1, end_at = COALESCE(end_at, ${NOW}), updated_at = ${NOW}
       WHERE id IN (SELECT e.id FROM time_entries e WHERE e.kind = 'break' AND e.is_deleted = 0 AND ${OPEN})`,
    )
    .run().changes
}
