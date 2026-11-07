import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { absenceTypesAdminQuery, adminSettingsQuery } from "@/features/admin/api/settings"
import { SETTINGS_TABS } from "@/features/admin/search"
import { SettingsPage } from "@/features/admin/settings/settings-page"

export const Route = createFileRoute("/_app/admin/settings")({
  staticData: { titleKey: "nav.settings" },
  validateSearch: z.object({ tab: z.enum(SETTINGS_TABS).optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(adminSettingsQuery),
      deps.tab === "types" ? context.queryClient.ensureQueryData(absenceTypesAdminQuery) : null,
    ]),
  component: SettingsRoute,
})

function SettingsRoute() {
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <SettingsPage
      tab={tab ?? "company"}
      onTab={(next) =>
        navigate({ search: { tab: next === "company" ? undefined : next }, replace: true, resetScroll: false })
      }
    />
  )
}
