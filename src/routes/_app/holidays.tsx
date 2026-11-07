import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { myHolidaysQuery } from "@/features/holidays/api"
import { MyHolidaysPage } from "@/features/holidays/holidays-page"
import { todayIn } from "@/features/time/lib"

/** The public holidays that apply to the signed-in person (read-only). */
export const Route = createFileRoute("/_app/holidays")({
  staticData: { titleKey: "nav.holidays" },
  validateSearch: z.object({ year: z.coerce.number().int().min(1990).max(2100).optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: async ({ context: { queryClient: qc, me }, deps }) => {
    const thisYear = Number(todayIn(me.timezone).slice(0, 4))
    await qc.ensureQueryData(myHolidaysQuery(deps.year ?? thisYear))
    return { thisYear }
  },
  component: HolidaysRoute,
})

function HolidaysRoute() {
  const { thisYear } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <MyHolidaysPage
      year={search.year ?? thisYear}
      thisYear={thisYear}
      onYear={(year) => navigate({ search: { year }, replace: true, resetScroll: false })}
    />
  )
}
