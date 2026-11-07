/**
 * Public holidays as seen by one person for the target-hour calculation. Which calendar applies (own, team,
 * company default) is decided by applicableCalendar in holiday-calendars.ts, the same function behind the
 * person's Public holidays page; calendar CRUD and imports live there too.
 */
import { and, eq, gte, lte } from "drizzle-orm"
import { db } from "../db"
import { type Holiday, holidays, type User } from "../db/schema"
import { applicableCalendar } from "./holiday-calendars"

export function resolveCalendarId(user: Pick<User, "holidayCalendarId" | "teamId">): number | null {
  return applicableCalendar(user)?.calendar.id ?? null
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
