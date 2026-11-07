import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { calendarsQuery, calendarYearQuery } from "@/features/admin/api/holidays"
import { HolidaysPage } from "@/features/admin/holidays/holidays-page"

export const Route = createFileRoute("/_app/admin/holidays")({
  staticData: { titleKey: "nav.holiday_calendars" },
  validateSearch: z.object({
    cal: z.coerce.number().int().positive().optional().catch(undefined),
    year: z.coerce.number().int().min(1990).max(2100).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const cals = await context.queryClient.ensureQueryData(calendarsQuery)
    const cal = cals.find((c) => c.id === deps.cal) ?? cals.find((c) => c.isDefault) ?? cals[0]
    if (cal) await context.queryClient.ensureQueryData(calendarYearQuery(cal.id, deps.year ?? new Date().getFullYear()))
  },
  component: HolidaysRoute,
})

function HolidaysRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return <HolidaysPage search={search} onSearch={(s) => navigate({ search: s, replace: true, resetScroll: false })} />
}
