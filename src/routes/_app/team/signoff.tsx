import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"
import { Page } from "@/components/app/page"
import { Skeleton } from "@/components/ui/skeleton"
import { signoffOverviewQuery } from "@/features/signoff/api"
import { SignoffPage } from "@/features/signoff/signoff-page"
import { teamScopeQuery } from "@/features/team/api"

export const Route = createFileRoute("/_app/team/signoff")({
  staticData: { titleKey: "nav.signoff" },
  validateSearch: z.object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .catch(undefined),
    team: z.coerce.number().int().positive().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  beforeLoad: ({ context }) => {
    if (!context.me.isManager) throw redirect({ to: "/" })
  },
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(teamScopeQuery),
      context.queryClient.ensureQueryData(
        signoffOverviewQuery({ month: deps.month ?? null, teamId: deps.team ?? null }),
      ),
    ]),
  pendingComponent: () => (
    <Page>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-96 rounded-xl" />
    </Page>
  ),
  component: SignoffRoute,
})

function SignoffRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <SignoffPage
      search={search}
      onSearch={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false })}
    />
  )
}
