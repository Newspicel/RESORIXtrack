import { createFileRoute } from "@tanstack/react-router"
import { teamsQuery } from "@/features/admin/api/teams"
import { userRefsQuery } from "@/features/admin/api/users"
import { TeamsPage } from "@/features/admin/teams/teams-page"

export const Route = createFileRoute("/_app/admin/teams")({
  staticData: { titleKey: "nav.teams" },
  loader: ({ context }) =>
    Promise.all([context.queryClient.ensureQueryData(teamsQuery), context.queryClient.ensureQueryData(userRefsQuery)]),
  component: TeamsPage,
})
