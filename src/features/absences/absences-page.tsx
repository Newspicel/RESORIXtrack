import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { Paperclip, Plus, Thermometer } from "lucide-react"
import { useState } from "react"
import { Page, PageHeader, Section } from "@/components/app/page"
import { PeriodNav } from "@/components/app/period-nav"
import { AbsenceStatusBadge, ColorDot } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { StatCard, StatGrid } from "@/components/data/stat"
import { tableHelper } from "@/components/data/table-helper"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { fmtDays } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { AbsenceDto } from "@/server/services/absences"
import { AbsenceSheet } from "./absence-sheet"
import { absenceOverviewQuery, absencesQuery } from "./api"
import { formatSpan, splitAbsences, upcomingParams, yearParams } from "./lib"
import { OwnCalendar } from "./own-calendar"
import { type RequestMode, RequestSheet } from "./request-sheet"

export interface AbsencesSearch {
  request?: string
  year?: number
  view?: "year" | "month"
  month?: string
}

const col = tableHelper<AbsenceDto>()

function useColumns(today: string) {
  const i = useI18n()
  const { t, absenceLabel } = i
  return [
    col.accessor((a) => absenceLabel(a.type), {
      id: "type",
      header: () => t("absences.type"),
      meta: { primary: true, mobileLabel: t("absences.type") },
      cell: (c) => (
        <span className="flex items-center gap-2 font-medium">
          <ColorDot color={c.row.original.type.color} />
          {c.getValue()}
        </span>
      ),
    }),
    col.accessor("startDate", {
      header: () => t("absences.period"),
      meta: { mobileLabel: t("absences.period") },
      cell: (c) => (
        <span className="whitespace-normal md:whitespace-nowrap">{formatSpan(c.row.original, i, { today })}</span>
      ),
    }),
    col.accessor("days", {
      header: () => t("absences.days"),
      meta: { numeric: true, mobileLabel: t("absences.days") },
      cell: (c) => fmtDays(c.getValue()),
    }),
    col.accessor("status", {
      header: () => t("common.status"),
      meta: { mobileLabel: t("common.status") },
      cell: (c) => <AbsenceStatusBadge status={c.getValue()} label={t(`absences.status.${c.getValue()}`)} />,
    }),
    col.accessor((a) => a.attachments.length, {
      id: "docs",
      header: () => <span className="sr-only">{t("absences.attachments")}</span>,
      enableSorting: false,
      meta: { hideOnMobile: true, numeric: true },
      cell: (c) =>
        c.getValue() ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground" title={t("absences.attachments")}>
            <Paperclip className="size-3.5" aria-label={t("absences.attachments")} />
            {c.getValue()}
          </span>
        ) : null,
    }),
  ]
}

export function AbsencesPage({
  userId,
  search,
  onSearch,
}: {
  userId: number
  search: AbsencesSearch
  onSearch: (s: AbsencesSearch) => void
}) {
  const i = useI18n()
  const { t } = i
  const overview = useSuspenseQuery(absenceOverviewQuery({ year: search.year ?? null })).data
  const { today, year, vacation: v } = overview
  const upcomingQ = useSuspenseQuery(absencesQuery(upcomingParams(userId, today))).data
  const yearQ = useQuery(absencesQuery(yearParams(userId, year)))
  const columns = useColumns(today)

  // keep the last mode/absence while the overlay animates out
  const [mode, setMode] = useState<RequestMode>({ kind: "new" })
  const [requestOpen, setRequestOpen] = useState(Boolean(search.request))
  const [detail, setDetail] = useState<AbsenceDto | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const openDetail = (a: AbsenceDto) => {
    setDetail(a)
    setDetailOpen(true)
  }
  const { upcoming } = splitAbsences(upcomingQ, today, year)
  const { past } = splitAbsences(yearQ.data ?? [], today, year)

  const total = v.carriedOver + v.entitlement + v.adjustments
  const sick = overview.sick
  const ctx = { today, sickBackdateDays: overview.sickBackdateDays, sickMaxDays: overview.sickMaxDays, self: true }
  const thisYear = Number(today.slice(0, 4))

  const openRequest = (m: RequestMode) => {
    setMode(m)
    setRequestOpen(true)
  }
  const closeRequest = () => {
    setRequestOpen(false)
    if (search.request) onSearch({ ...search, request: undefined })
  }
  const byId = (id: number) => [...upcomingQ, ...(yearQ.data ?? [])].find((a) => a.id === id)

  return (
    <Page>
      <PageHeader
        title={t("absences.title")}
        actions={
          <>
            {sick?.allowed ? (
              <Button variant="outline" onClick={() => openRequest({ kind: "sick" })}>
                <Thermometer data-icon="inline-start" />
                {t("absences.report_sick")}
              </Button>
            ) : null}
            <Button onClick={() => openRequest({ kind: "new" })}>
              <Plus data-icon="inline-start" />
              {t("absences.request")}
            </Button>
          </>
        }
      />

      {sick?.reason === "already_sick" ? (
        <Alert>
          <Thermometer />
          <AlertDescription>{t("absences.sick_not_allowed.already_sick")}</AlertDescription>
        </Alert>
      ) : null}

      <Section
        title={t("absences.vacation_account", { year })}
        actions={
          <PeriodNav
            label={String(year)}
            onPrev={() => onSearch({ ...search, year: year - 1, month: undefined })}
            onNext={() => onSearch({ ...search, year: year + 1, month: undefined })}
            onToday={() => onSearch({ ...search, year: undefined, month: undefined })}
            isCurrent={year === thisYear}
          />
        }
      >
        <StatGrid>
          <StatCard
            label={t("absences.remaining")}
            value={fmtDays(v.remaining)}
            unit={t("common.days")}
            hint={t("absences.of_total", { n: fmtDays(total) })}
            progress={total > 0 ? (v.taken + v.planned) / total : 0}
            tone={v.remaining < 0 ? "negative" : "default"}
          />
          <StatCard label={t("absences.taken")} value={fmtDays(v.taken)} unit={t("common.days")} />
          <StatCard label={t("absences.planned")} value={fmtDays(v.planned)} unit={t("common.days")} />
          <StatCard label={t("absences.pending_days")} value={fmtDays(v.pending)} unit={t("common.days")} />
        </StatGrid>
      </Section>

      <Section title={t("absences.upcoming")}>
        <DataTable
          data={upcoming}
          columns={columns}
          getRowId={(a) => String(a.id)}
          onRowClick={openDetail}
          caption={t("absences.upcoming")}
          empty={
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">{t("absences.none_upcoming")}</p>
              <Button variant="outline" size="sm" onClick={() => openRequest({ kind: "new" })}>
                <Plus data-icon="inline-start" />
                {t("absences.request")}
              </Button>
            </div>
          }
        />
      </Section>

      <OwnCalendar
        year={year}
        today={today}
        view={search.view ?? "year"}
        month={
          search.month?.startsWith(`${year}-`) ? search.month : year === thisYear ? today.slice(0, 7) : `${year}-01`
        }
        onView={(view) => onSearch({ ...search, view })}
        onMonth={(month) =>
          onSearch({
            ...search,
            month,
            year: Number(month.slice(0, 4)) === thisYear ? undefined : Number(month.slice(0, 4)),
          })
        }
        onOpenAbsence={(id) => {
          const a = byId(id)
          if (a) openDetail(a)
        }}
        onRequest={(date) => openRequest({ kind: "new", start: date })}
      />

      <Section title={t("absences.past", { year })}>
        <DataTable
          data={past}
          columns={columns}
          getRowId={(a) => String(a.id)}
          onRowClick={openDetail}
          loading={yearQ.isPending}
          caption={t("absences.past", { year })}
          empty={<p className="text-sm text-muted-foreground">{t("absences.none_past")}</p>}
        />
      </Section>

      <RequestSheet open={requestOpen} onOpenChange={(o) => !o && closeRequest()} mode={mode} ctx={ctx} />
      <AbsenceSheet
        absence={detail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={(a) => {
          setDetailOpen(false)
          openRequest({ kind: "edit", absence: a })
        }}
      />
    </Page>
  )
}
