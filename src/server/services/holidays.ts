/**
 * Public holidays as seen by one person: their own calendar, else their team's, else the default calendar.
 * Calendar CRUD and imports live in holiday-calendars.ts.
 */
import { and, eq, gte, lte } from "drizzle-orm"
import { db } from "../db"
import { type Holiday, holidayCalendars, holidays, teams, type User } from "../db/schema"

/** Where a person's calendar comes from: assigned to them, their team's, or the company default. */
export type CalendarSource = "user" | "team" | "default"

export function applicableCalendar(
  user: Pick<User, "holidayCalendarId" | "teamId">,
): { id: number; source: CalendarSource } | null {
  if (user.holidayCalendarId != null) return { id: user.holidayCalendarId, source: "user" }
  if (user.teamId != null) {
    const team = db.select({ cal: teams.holidayCalendarId }).from(teams).where(eq(teams.id, user.teamId)).get()
    if (team?.cal != null) return { id: team.cal, source: "team" }
  }
  const def = db
    .select({ id: holidayCalendars.id })
    .from(holidayCalendars)
    .where(eq(holidayCalendars.isDefault, true))
    .limit(1)
    .get()
  return def ? { id: def.id, source: "default" } : null
}

/** The same order reduces the target hours, so what people see on their holidays page is what counts. */
export function resolveCalendarId(user: Pick<User, "holidayCalendarId" | "teamId">): number | null {
  return applicableCalendar(user)?.id ?? null
}

/** Holidays of a calendar in [start, end], keyed by date. */
export function calendarHolidays(calendarId: number | null, start: string, end: string): Map<string, Holiday> {
  const out = new Map<string, Holiday>()
  if (calendarId == null) return out
  const rows = db
    .select()
    .from(holidays)
    .where(and(eq(holidays.calendarId, calendarId), gte(holidays.date, start), lte(holidays.date, end)))
    .all()
  for (const h of rows) out.set(h.date, h)
  return out
}

/** Holidays that apply to `user` in [start, end], keyed by date. */
export function holidaysFor(
  user: Pick<User, "holidayCalendarId" | "teamId">,
  start: string,
  end: string,
): Map<string, Holiday> {
  return calendarHolidays(resolveCalendarId(user), start, end)
}

export type Half = "am" | "pm"

/** Half-day holidays cover the afternoon (e.g. 24 Dec pm). */
export function holidayHalves(fraction: number): Half[] {
  if (fraction >= 1) return ["am", "pm"]
  if (fraction > 0) return ["pm"]
  return []
}
