import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { Page, PageHeader } from "@/components/app/page"
import { AccountSkeleton, AccountView } from "@/features/accounts/account-view"
import { accountQuery } from "@/features/accounts/api"
import { useT } from "@/lib/i18n"

const search = z.object({ year: z.coerce.number().int().min(1990).max(2100).optional().catch(undefined) })

export const Route = createFileRoute("/_app/account")({
  staticData: { titleKey: "nav.account" },
  validateSearch: search,
  loaderDeps: ({ search: s }) => ({ year: s.year }),
  loader: ({ context: { queryClient: qc }, deps }) => qc.ensureQueryData(accountQuery({ year: deps.year })),
  pendingComponent: Pending,
  component: AccountPage,
})

function Pending() {
  const t = useT()
  return (
    <Page>
      <PageHeader title={t("account.title")} />
      <AccountSkeleton />
    </Page>
  )
}

function AccountPage() {
  const t = useT()
  const { year } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <Page>
      <PageHeader title={t("account.title")} />
      <AccountView
        year={year}
        onYear={(y) => void navigate({ search: { year: y }, replace: true, resetScroll: false })}
      />
    </Page>
  )
}
