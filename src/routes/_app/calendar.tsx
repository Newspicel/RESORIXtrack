import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"
import { Page, PageHeader } from "@/components/app/page"
import { Skeleton } from "@/components/ui/skeleton"
import { absenceOverviewQuery } from "@/features/absences/api"
import { TeamCalendarView } from "@/features/absences/team-calendar-view"
import { teamCalendarQuery } from "@/features/team/api"
import { monthRange } from "@/lib/format"
import { useT } from "@/lib/i18n"

/** Who is away when in the person's team (managers see their teams). */
export const Route = createFileRoute("/_app/calendar")({
  staticData: { titleKey: "nav.team_calendar" },
  validateSearch: z.object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .catch(undefined),
    team: z.coerce.number().int().positive().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ month: search.month, team: search.team }),
  beforeLoad: ({ context: { me } }) => {
    if (!me.teamId && !me.isManager) throw redirect({ to: "/" })
  },
  loader: async ({ context: { queryClient: qc }, deps }) => {
    const { today } = await qc.ensureQueryData(absenceOverviewQuery())
    await qc.ensureQueryData(
      teamCalendarQuery({ ...monthRange(deps.month ?? today.slice(0, 7)), teamId: deps.team ?? null }),
    )
  },
  pendingComponent: () => (
    <Page>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[28rem] rounded-xl" />
    </Page>
  ),
  component: CalendarRoute,
})

function CalendarRoute() {
  const t = useT()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { today } = useSuspenseQuery(absenceOverviewQuery()).data
  return (
    <Page>
      <PageHeader title={t("absences.team.title")} />
      <TeamCalendarView
        month={search.month ?? today.slice(0, 7)}
        today={today}
        teamId={search.team ?? null}
        onMonth={(month) => navigate({ search: { ...search, month }, replace: true, resetScroll: false })}
        onTeam={(team) =>
          navigate({ search: { ...search, team: team ?? undefined }, replace: true, resetScroll: false })
        }
      />
    </Page>
  )
}
