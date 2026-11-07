/**
 * Break entries are retired: a break is the gap between two work entries. Old break rows outside signed-off
 * months are soft-deleted like a person deletes an entry, with a revision row each; signed-off months stay
 * untouched. Migration 0006 runs the same statements (kept in sync by a test); `rt import-v1` runs them for
 * v1 databases older than v1 Alembic 0003.
 */
import type Database from "better-sqlite3"

const NOW = "strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')"
const MS = (col: string) => `substr(${col}, 1, 23) || 'Z'`
const LIVE_BREAK = `e.kind = 'break' AND e.is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = e.user_id AND s.reopened_at IS NULL AND e.start_at < s.period_end_utc AND COALESCE(e.end_at, '9999-12-31T00:00:00.000000Z') > s.period_start_utc)`
const snapshotJson = (endAt: string, deleted: boolean) =>
  `json_object('kind', e.kind, 'start_at', ${MS("e.start_at")}, 'end_at', ${endAt}, 'scheduled_end_at', NULL, 'tz', e.tz, 'note', e.note, 'source', e.source, 'is_deleted', json('${deleted}'))`

export const RETIRE_LEGACY_BREAKS = [
  `INSERT INTO revisions (entity, entity_id, subject_user_id, actor_id, action, before, after, reason, source, at) SELECT 'time_entry', e.id, e.user_id, NULL, 'delete', ${snapshotJson(`CASE WHEN e.end_at IS NULL THEN NULL ELSE ${MS("e.end_at")} END`, false)}, ${snapshotJson(MS(`COALESCE(e.end_at, ${NOW})`), true)}, 'A break is the gap between two entries now', 'migration', ${NOW} FROM time_entries e WHERE ${LIVE_BREAK};`,
  `UPDATE time_entries AS e SET is_deleted = 1, end_at = COALESCE(e.end_at, ${NOW}), updated_at = ${NOW} WHERE ${LIVE_BREAK};`,
] as const

/** Returns the number of retired entries. */
export function retireLegacyBreaks(sqlite: Database.Database): number {
  sqlite.prepare(RETIRE_LEGACY_BREAKS[0]).run()
  return sqlite.prepare(RETIRE_LEGACY_BREAKS[1]).run().changes
}
