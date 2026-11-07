import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { userDetailQuery, userRefsQuery } from "@/features/admin/api/users"
import { USER_TABS } from "@/features/admin/search"
import { UserDetailPage } from "@/features/admin/users/user-detail"

export const Route = createFileRoute("/_app/admin/users/$userId")({
  staticData: { titleKey: "nav.users" },
  params: {
    parse: (p) => ({ userId: z.coerce.number().int().positive().parse(p.userId) }),
    stringify: (p) => ({ userId: String(p.userId) }),
  },
  validateSearch: z.object({ tab: z.enum(USER_TABS).optional().catch(undefined) }),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(userDetailQuery(params.userId)),
      context.queryClient.ensureQueryData(userRefsQuery),
    ]),
  component: UserRoute,
})

function UserRoute() {
  const { userId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <UserDetailPage
      userId={userId}
      tab={tab ?? "profile"}
      onTab={(next) =>
        navigate({ search: { tab: next === "profile" ? undefined : next }, replace: true, resetScroll: false })
      }
    />
  )
}
