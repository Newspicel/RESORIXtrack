/** "Public holidays": the calendar that applies to the signed-in person, read-only, year by year. */
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Settings } from "lucide-react"
import { Page, PageHeader } from "@/components/app/page"
import { PeriodContent, PeriodNav } from "@/components/app/period-nav"
import { StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { ButtonLink } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { MyHolidays } from "@/server/services/holiday-calendars"
import { myHolidaysQuery } from "./api"
import { useHolidayColumns } from "./columns"

export function MyHolidaysPage({
  year,
  thisYear,
  onYear,
}: {
  year: number
  thisYear: number
  onYear: (year: number) => void
}) {
  const { t } = useI18n()
  const me = useMe()
  const { data, isLoading } = useQuery(myHolidaysQuery(year))
  return (
    <Page>
      <PageHeader
        title={t("nav.holidays")}
        description={t("public_holidays.sub")}
        actions={
          me.isAdmin ? (
            <ButtonLink variant="outline" render={<Link to="/admin/holidays" />}>
              <Settings data-icon="inline-start" />
              {t("public_holidays.manage")}
            </ButtonLink>
          ) : null
        }
      />
      {data === null ? (
        <Empty className="rounded-xl border bg-card">
          <EmptyHeader>
            <EmptyTitle>{t("public_holidays.none")}</EmptyTitle>
            <EmptyDescription>{t("public_holidays.none_help")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <CalendarYear data={data} loading={isLoading} year={year} thisYear={thisYear} onYear={onYear} />
      )}
    </Page>
  )
}

function CalendarYear({
  data,
  loading,
  year,
  thisYear,
  onYear,
}: {
  data: MyHolidays | undefined
  loading: boolean
  year: number
  thisYear: number
  onYear: (year: number) => void
}) {
  const { t } = useI18n()
  const columns = useHolidayColumns<MyHolidays["holidays"][number]>()
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={data?.name ?? t("nav.holidays")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="truncate text-base font-semibold">{data?.name}</h2>
          {data ? <StatusBadge tone="brand">{t(`public_holidays.source.${data.source}`)}</StatusBadge> : null}
        </div>
        <PeriodNav
          label={String(year)}
          onPrev={() => onYear(year - 1)}
          onNext={() => onYear(year + 1)}
          onToday={() => onYear(thisYear)}
          isCurrent={year === thisYear}
        />
      </div>
      <PeriodContent>
        <DataTable
          data={data?.holidays ?? []}
          loading={loading}
          columns={columns}
          getRowId={(r) => String(r.id)}
          empty={t("admin.holidays.none_in_year", { year })}
        />
      </PeriodContent>
      <p className="text-sm text-muted-foreground">{t("public_holidays.help")}</p>
    </section>
  )
}
