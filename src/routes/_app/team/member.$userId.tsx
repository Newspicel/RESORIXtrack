import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"
import { Page } from "@/components/app/page"
import { Skeleton } from "@/components/ui/skeleton"
import { memberQuery } from "@/features/team/api"
import { MemberPage } from "@/features/team/member-page"
import { MEMBER_TABS, memberPeriodParams } from "@/features/team/search"
import { periodQuery } from "@/features/time/api"
import { todayIn } from "@/features/time/lib"

export const Route = createFileRoute("/_app/team/member/$userId")({
  staticData: { titleKey: "nav.team" },
  params: {
    parse: (p) => ({ userId: z.coerce.number().int().positive().parse(p.userId) }),
    stringify: (p) => ({ userId: String(p.userId) }),
  },
  validateSearch: z.object({
    tab: z.enum(MEMBER_TABS).optional().catch(undefined),
    week: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .catch(undefined),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  beforeLoad: ({ context }) => {
    if (!context.me.isManager) throw redirect({ to: "/" })
  },
  loader: async ({ context: { queryClient: qc, me }, params, deps, cause }) => {
    const member = qc.ensureQueryData(memberQuery(params.userId))
    // tabs stream in their own boundaries on entry; a period step waits here so the slide shows the new period
    if (cause === "stay" && (deps.tab ?? "time") === "time") {
      await qc.ensureQueryData(periodQuery(memberPeriodParams(params.userId, deps, todayIn(me.timezone))))
    }
    return member
  },
  pendingComponent: () => (
    <Page>
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </Page>
  ),
  component: MemberRoute,
})

function MemberRoute() {
  const { userId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <MemberPage
      userId={userId}
      search={search}
      onSearch={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false })}
    />
  )
}
