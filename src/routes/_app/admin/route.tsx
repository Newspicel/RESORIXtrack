import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

/** Administration: administrators only; everyone else lands on the dashboard. */
export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    if (!context.me.isAdmin) throw redirect({ to: "/" })
  },
  component: Outlet,
})
