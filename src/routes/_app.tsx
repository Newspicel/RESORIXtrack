import { createFileRoute, redirect } from "@tanstack/react-router"
import { AppShell } from "@/components/app/app-shell"

/** Everything behind sign-in. Unauthenticated visitors go to /login (or /setup on a fresh install). */
export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context, location }) => {
    const b = context.bootstrap
    if (!b.me) {
      if (!b.company.setupComplete) throw redirect({ to: "/setup" })
      throw redirect({ to: "/login", search: location.href !== "/" ? { next: location.href } : {} })
    }
    return { me: b.me }
  },
  component: AppShell,
})
