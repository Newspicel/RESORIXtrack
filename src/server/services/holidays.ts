/**
 * Public holidays as seen by one person for the target-hour calculation. Which calendar applies (own, team,
 * company default) is decided by applicableCalendar in holiday-calendars.ts, the same function behind the
 * person's Public holidays page; calendar CRUD and imports live there too. Signed-off months keep the calendar
 * they were counted with, so assigning another calendar (to the person, their team or the company) only
 * changes open months.
 */
import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm"
import { db } from "../db"
import { type Holiday, holidays, monthSignoffs, type User } from "../db/schema"
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
  user: Pick<User, "id" | "holidayCalendarId" | "teamId">,
  start: string,
  end: string,
): Map<string, Holiday> {
  const current = resolveCalendarId(user)
  const out = calendarHolidays(current, start, end)
  const signed = db
    .select({
      from: monthSignoffs.periodStartDate,
      to: monthSignoffs.periodEndDate,
      calendarId: monthSignoffs.calendarId,
    })
    .from(monthSignoffs)
    .where(
      and(
        eq(monthSignoffs.userId, user.id),
        isNull(monthSignoffs.reopenedAt),
        isNotNull(monthSignoffs.calendarId),
        lte(monthSignoffs.periodStartDate, end),
        gte(monthSignoffs.periodEndDate, start),
      ),
    )
    .all()
  for (const s of signed) {
    if (s.calendarId === current) continue
    const from = s.from > start ? s.from : start
    const to = s.to < end ? s.to : end
    for (const d of out.keys()) if (d >= from && d <= to) out.delete(d)
    for (const [d, h] of calendarHolidays(s.calendarId, from, to)) out.set(d, h)
  }
  return out
}

export type Half = "am" | "pm"

/** Half-day holidays cover the afternoon (e.g. 24 Dec pm). */
export function holidayHalves(fraction: number): Half[] {
  if (fraction >= 1) return ["am", "pm"]
  if (fraction > 0) return ["pm"]
  return []
}
