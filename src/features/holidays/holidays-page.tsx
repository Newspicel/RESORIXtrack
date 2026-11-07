/**
 * Public holidays of the signed-in person: the calendar that applies to them (own, team or company default),
 * one year at a time. Read-only; administrators get a link to the calendar administration.
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { CalendarCog } from "lucide-react"
import { Page, PageHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { TabStrip } from "@/components/app/tab-strip"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { ButtonLink } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fmtDay, parseDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { MyHolidays } from "@/server/services/holiday-calendars"
import { myHolidaysQuery } from "./api"

type Row = MyHolidays["holidays"][number]
const col = tableHelper<Row>()

export function HolidaysPage({ year, onYear }: { year?: number; onYear: (year: number) => void }) {
  const { t, intl, holidayName } = useI18n()
  const me = useMe()
  // the route loader fetches every year before navigating, so this never suspends on the client
  const { data } = useSuspenseQuery(myHolidaysQuery(year))
  const manage = me.isAdmin ? (
    <ButtonLink variant="outline" render={<Link to="/admin/holidays" />}>
      <CalendarCog data-icon="inline-start" />
      {t("public_holidays.manage")}
    </ButtonLink>
  ) : null
  if (data === null) {
    return (
      <Page>
        <PageHeader title={t("public_holidays.title")} actions={manage} />
        <Empty className="rounded-xl border bg-card">
          <EmptyHeader>
            <EmptyTitle>{t("public_holidays.none")}</EmptyTitle>
            <EmptyDescription>{t("public_holidays.none_help")}</EmptyDescription>
          </EmptyHeader>
          {manage ? <EmptyContent>{manage}</EmptyContent> : null}
        </Empty>
      </Page>
    )
  }
  const shown = data.year
  const columns = [
    col.accessor("date", {
      header: () => t("common.date"),
      meta: { className: "whitespace-nowrap w-72", mobileLabel: t("common.date") },
      cell: (c) => {
        const wd = parseDay(c.getValue()).getUTCDay()
        // fixed columns: weekday · date · weekend badge always start at the same x; the badge never grows the row
        return (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular md:grid md:grid-cols-[2rem_5.5rem_auto]">
            <span className="text-muted-foreground">{fmtDay(c.getValue(), intl, { weekday: "short" })}</span>
            <span>{fmtDay(c.getValue(), intl, { day: "numeric", month: "short" })}</span>
            {wd === 0 || wd === 6 ? (
              <StatusBadge className="h-5 justify-self-start">{t("public_holidays.weekend")}</StatusBadge>
            ) : null}
          </span>
        )
      },
    }),
    col.accessor("name", {
      header: () => t("common.name"),
      meta: { primary: true },
      cell: (c) => holidayName(c.getValue()),
    }),
    col.accessor("fraction", {
      header: () => t("public_holidays.duration"),
      meta: { mobileLabel: t("public_holidays.duration") },
      cell: (c) =>
        c.getValue() < 1 ? (
          <StatusBadge tone="info">{t("public_holidays.half_day")}</StatusBadge>
        ) : (
          <span className="text-muted-foreground">{t("public_holidays.full_day")}</span>
        ),
    }),
  ]
  return (
    <Page>
      <PageHeader title={t("public_holidays.title")} description={t("public_holidays.sub")} actions={manage} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="truncate text-base font-semibold">{data.calendar.name}</h2>
        {data.calendar.regionCode ? (
          <span className="text-sm whitespace-nowrap text-muted-foreground">{data.calendar.regionCode}</span>
        ) : null}
        <StatusBadge tone="brand">
          {data.source === "team"
            ? t("public_holidays.source_team", { team: data.team?.name ?? "" })
            : t(`public_holidays.source_${data.source}`)}
        </StatusBadge>
      </div>
      <Tabs value={String(shown)} onValueChange={(v) => onYear(Number(v))} className="gap-4">
        <TabStrip>
          <TabsList variant="line">
            {data.years.map((y) => (
              <TabsTrigger key={y} value={String(y)}>
                {y}
              </TabsTrigger>
            ))}
          </TabsList>
        </TabStrip>
        <TabsContent value={String(shown)}>
          <DataTable
            data={data.holidays}
            columns={columns}
            getRowId={(r) => String(r.id)}
            empty={t("public_holidays.none_in_year", { year: shown })}
          />
        </TabsContent>
      </Tabs>
    </Page>
  )
}
