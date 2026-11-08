/**
 * Sign-offs without a recorded holiday calendar (from before migration 0010, or copied by `rt import-v1`) get
 * the one that applies today: the person's own, else their team's, else the company default. Same statement as
 * migration 0010; the importer runs it because the target database was migrated before the rows were copied.
 */
import type Database from "better-sqlite3"

export function fillSignoffCalendars(sqlite: Database.Database): number {
  return sqlite
    .prepare(
      `UPDATE month_signoffs SET calendar_id = COALESCE(
         (SELECT c.id FROM users u JOIN holiday_calendars c ON c.id = u.holiday_calendar_id WHERE u.id = month_signoffs.user_id),
         (SELECT c.id FROM users u JOIN teams t ON t.id = u.team_id JOIN holiday_calendars c ON c.id = t.holiday_calendar_id
           WHERE u.id = month_signoffs.user_id),
         (SELECT id FROM holiday_calendars WHERE is_default = 1 ORDER BY id LIMIT 1))
       WHERE calendar_id IS NULL`,
    )
    .run().changes
}
