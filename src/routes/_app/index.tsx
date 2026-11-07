import { createFileRoute } from "@tanstack/react-router"
import { liveClockQuery } from "@/features/clock/use-clock"
import { Dashboard, DashboardSkeleton } from "@/features/dashboard/dashboard"
import { timeOverviewQuery } from "@/features/time/api"

export const Route = createFileRoute("/_app/")({
  staticData: { titleKey: "nav.dashboard" },
  loader: ({ context: { queryClient: qc } }) =>
    Promise.all([qc.ensureQueryData(timeOverviewQuery()), qc.ensureQueryData(liveClockQuery())]),
  pendingComponent: DashboardSkeleton,
  component: Dashboard,
})
