import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

/** Team section: leads, deputies and HR; project managers and administrators (approvals of last resort) reach their pages. */
export const Route = createFileRoute("/_app/team")({
  beforeLoad: ({ context }) => {
    const me = context.me
    if (!me.isManager && !me.canProjects && !me.isAdmin) throw redirect({ to: "/" })
  },
  component: Outlet,
})
