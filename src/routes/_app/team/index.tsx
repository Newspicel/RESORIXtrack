import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"
import { Page } from "@/components/app/page"
import { Skeleton } from "@/components/ui/skeleton"
import { teamOverviewQuery, teamScopeQuery } from "@/features/team/api"
import { TeamOverviewPage } from "@/features/team/overview-page"

export const Route = createFileRoute("/_app/team/")({
  staticData: { titleKey: "nav.team" },
  validateSearch: z.object({
    team: z.coerce.number().int().positive().optional().catch(undefined),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  beforeLoad: ({ context }) => {
    if (!context.me.isManager) throw redirect({ to: context.me.canProjects ? "/team/projects" : "/" })
  },
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(teamScopeQuery),
      context.queryClient.ensureQueryData(teamOverviewQuery({ teamId: deps.team ?? null, month: deps.month ?? null })),
    ]),
  pendingComponent: () => (
    <Page>
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="col-span-2 h-28 rounded-xl lg:col-span-1" />
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </Page>
  ),
  component: TeamRoute,
})

function TeamRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <TeamOverviewPage
      search={search}
      onSearch={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false })}
    />
  )
}
