import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { Page } from "@/components/app/page"
import { Skeleton } from "@/components/ui/skeleton"
import { AbsencesPage } from "@/features/absences/absences-page"
import { absenceOverviewQuery, absencesQuery, absenceTypesQuery, calendarDaysQuery } from "@/features/absences/api"
import { upcomingParams, yearParams } from "@/features/absences/lib"

export const Route = createFileRoute("/_app/absences")({
  staticData: { titleKey: "nav.absences" },
  validateSearch: z.object({
    request: z.coerce.string().optional().catch(undefined),
    year: z.coerce.number().int().min(1990).max(2100).optional().catch(undefined),
    view: z.enum(["year", "month"]).optional().catch(undefined),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: async ({ context: { queryClient: qc, me }, deps }) => {
    const overview = await qc.ensureQueryData(absenceOverviewQuery({ year: deps.year ?? null }))
    await Promise.all([
      qc.ensureQueryData(absencesQuery(upcomingParams(me.id, overview.today))),
      qc.ensureQueryData(absencesQuery(yearParams(me.id, overview.year))),
      qc.ensureQueryData(
        calendarDaysQuery({ userId: null, from: `${overview.year}-01-01`, to: `${overview.year}-12-31` }),
      ),
      qc.ensureQueryData(absenceTypesQuery),
    ])
  },
  pendingComponent: AbsencesSkeleton,
  component: AbsencesRoute,
})

function AbsencesRoute() {
  const { me } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <AbsencesPage
      userId={me.id}
      search={search}
      onSearch={(s) => navigate({ search: s, replace: true, resetScroll: false })}
    />
  )
}

function AbsencesSkeleton() {
  return (
    <Page>
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </Page>
  )
}
