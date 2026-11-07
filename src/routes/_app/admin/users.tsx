import { createFileRoute, Outlet, useChildMatches } from "@tanstack/react-router"
import { z } from "zod"
import { userRefsQuery, usersQuery } from "@/features/admin/api/users"
import { USER_ROLE_FILTERS, USER_STATUS_FILTERS } from "@/features/admin/search"
import { UsersPage } from "@/features/admin/users/users-page"

const search = z.object({
  status: z.enum(USER_STATUS_FILTERS).optional().catch(undefined),
  team: z.string().max(12).optional().catch(undefined),
  role: z.enum(USER_ROLE_FILTERS).optional().catch(undefined),
})

export const Route = createFileRoute("/_app/admin/users")({
  staticData: { titleKey: "nav.users" },
  validateSearch: search,
  loaderDeps: ({ search: s }) => ({ status: s.status ?? "active" }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(usersQuery(deps.status)),
      context.queryClient.ensureQueryData(userRefsQuery),
    ]),
  component: UsersRoute,
})

function UsersRoute() {
  // the person page (users.$userId) is a child route; it replaces the list
  const child = useChildMatches()
  return child.length ? <Outlet /> : <UsersList />
}

function UsersList() {
  const s = Route.useSearch()
  const navigate = Route.useNavigate()
  return <UsersPage search={s} onSearch={(next) => navigate({ search: next, replace: true, resetScroll: false })} />
}
