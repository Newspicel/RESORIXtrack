import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed } from "@/server/middleware"
import { myHolidays } from "@/server/services/holiday-calendars"

/** The calendar that applies to the signed-in person and its holidays of one year (default: this year). */
export const fetchMyHolidays = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ year: z.number().int().min(1990).max(2100).nullish() }))
  .handler(({ data, context: { actor } }) => myHolidays(actor, data.year ?? undefined))

export const myHolidaysQuery = (year?: number | null) =>
  queryOptions({ queryKey: ["holidays", "mine", year ?? null], queryFn: () => fetchMyHolidays({ data: { year } }) })
