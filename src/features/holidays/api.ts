import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed } from "@/server/middleware"
import { myHolidays } from "@/server/services/holiday-calendars"

export const fetchMyHolidays = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ year: z.number().int().min(1990).max(2100) }))
  .handler(({ data, context: { actor } }) => myHolidays(actor, data.year))

export const myHolidaysQuery = (year: number) =>
  queryOptions({ queryKey: ["holidays", "mine", year], queryFn: () => fetchMyHolidays({ data: { year } }) })
