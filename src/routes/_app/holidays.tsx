import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { Page, PageHeader } from "@/components/app/page"
import { Skeleton } from "@/components/ui/skeleton"
import { myHolidaysQuery } from "@/features/holidays/api"
import { HolidaysPage } from "@/features/holidays/holidays-page"
import { useT } from "@/lib/i18n"

export const Route = createFileRoute("/_app/holidays")({
  staticData: { titleKey: "nav.public_holidays" },
  validateSearch: z.object({ year: z.coerce.number().int().min(1990).max(2100).optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: ({ context: { queryClient: qc }, deps }) => qc.ensureQueryData(myHolidaysQuery(deps.year)),
  pendingComponent: Pending,
  component: HolidaysRoute,
})

function Pending() {
  const t = useT()
  return (
    <Page>
      <PageHeader title={t("public_holidays.title")} />
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="h-80 rounded-xl" />
    </Page>
  )
}

function HolidaysRoute() {
  const { year } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <HolidaysPage
      year={year}
      onYear={(y) => void navigate({ search: { year: y }, replace: true, resetScroll: false })}
    />
  )
}
