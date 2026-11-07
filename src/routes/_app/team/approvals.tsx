import { createFileRoute, redirect } from "@tanstack/react-router"
import { Page } from "@/components/app/page"
import { Skeleton } from "@/components/ui/skeleton"
import { absenceOverviewQuery, absenceTypesQuery } from "@/features/absences/api"
import { ApprovalsPage } from "@/features/absences/approvals-page"
import { approvalsQuery } from "@/features/team/api"

/** Leads, deputies and HR; administrators only while they are the approvers of last resort. */
export const Route = createFileRoute("/_app/team/approvals")({
  staticData: { titleKey: "nav.approvals" },
  beforeLoad: ({ context }) => {
    const { me, bootstrap } = context
    if (!me.isManager && !(me.isAdmin && bootstrap.counts.pendingApprovals > 0)) throw redirect({ to: "/" })
  },
  loader: ({ context: { queryClient: qc } }) =>
    Promise.all([
      qc.ensureQueryData(approvalsQuery),
      qc.ensureQueryData(absenceOverviewQuery()),
      qc.ensureQueryData(absenceTypesQuery),
    ]),
  pendingComponent: () => (
    <Page>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </Page>
  ),
  component: ApprovalsPage,
})
