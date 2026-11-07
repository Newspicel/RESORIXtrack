import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { CalendarPlus, Check, ChevronDown, Download, Pencil, Plus, Star } from "lucide-react"
import { useState } from "react"
import { Page, PageHeader } from "@/components/app/page"
import { PeriodContent, PeriodNav } from "@/components/app/period-nav"
import { StatusBadge } from "@/components/app/status-badge"
import { undoToast } from "@/components/app/undo-toast"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fmtDay, parseDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { CalendarRow } from "@/server/services/holiday-calendars"
import {
  addCompanyDayFn,
  calendarsQuery,
  calendarYearQuery,
  companyDaysQuery,
  saveHolidayFn,
  setDefaultCalendarFn,
} from "../api/holidays"
import { currentYear } from "../lib"
import { useAction } from "../ui"
import { CalendarSheet } from "./calendar-sheet"
import { type HolidayItem, HolidaySheet } from "./holiday-sheet"
import { ImportSheet } from "./import-sheet"

export type HolidaysSearch = { cal?: number; year?: number }

const col = tableHelper<HolidayItem>()

export function HolidaysPage({ search, onSearch }: { search: HolidaysSearch; onSearch: (s: HolidaysSearch) => void }) {
  const { t } = useI18n()
  const { data: calendars } = useSuspenseQuery(calendarsQuery)
  const [sheet, setSheet] = useState<"new" | "edit" | null>(null)
  const selected = calendars.find((c) => c.id === search.cal) ?? calendars.find((c) => c.isDefault) ?? calendars[0]
  const year = search.year ?? currentYear()
  return (
    <Page>
      <PageHeader
        title={t("admin.holidays.title")}
        actions={
          <Button onClick={() => setSheet("new")}>
            <CalendarPlus data-icon="inline-start" />
            {t("admin.holidays.new_calendar")}
          </Button>
        }
      />
      {calendars.length ? (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label={t("admin.holidays.calendars")} className="flex flex-col gap-1.5">
            {calendars.map((c) => (
              <CalendarButton
                key={c.id}
                cal={c}
                active={c.id === selected?.id}
                onClick={() => onSearch({ cal: c.id, year: search.year })}
              />
            ))}
          </nav>
          {selected ? (
            <CalendarPanel
              cal={selected}
              year={year}
              onYear={(y) => onSearch({ cal: selected.id, year: y })}
              onEdit={() => setSheet("edit")}
            />
          ) : null}
        </div>
      ) : (
        <Empty className="rounded-xl border bg-card">
          <EmptyHeader>
            <EmptyTitle>{t("admin.holidays.no_calendars")}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => setSheet("new")}>
              <CalendarPlus data-icon="inline-start" />
              {t("admin.holidays.new_calendar")}
            </Button>
          </EmptyContent>
        </Empty>
      )}
      {sheet ? (
        <CalendarSheet
          calendar={sheet === "edit" ? selected : undefined}
          onClose={() => setSheet(null)}
          onSaved={(id) => {
            setSheet(null)
            onSearch({ cal: id, year: search.year })
          }}
          onDeleted={() => {
            setSheet(null)
            onSearch({})
          }}
        />
      ) : null}
    </Page>
  )
}

function CalendarButton({ cal, active, onClick }: { cal: CalendarRow; active: boolean; onClick: () => void }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-3.5 py-3 text-left transition-colors duration-150",
        active ? "border-primary/50 bg-brand-soft" : "bg-card hover:bg-accent/60",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{cal.name}</span>
        {cal.isDefault ? <StatusBadge tone="brand">{t("admin.holidays.default")}</StatusBadge> : null}
      </span>
      <span className="text-xs text-muted-foreground tabular">
        {t("admin.holidays.n_holidays", { count: cal.holidayCount })}
        {cal.firstYear
          ? ` · ${cal.firstYear === cal.lastYear ? cal.firstYear : `${cal.firstYear}–${cal.lastYear}`}`
          : ""}
        {cal.teamCount + cal.userCount
          ? ` · ${t("admin.holidays.usage", { teams: cal.teamCount, users: cal.userCount })}`
          : ""}
      </span>
    </button>
  )
}

function CalendarPanel({
  cal,
  year,
  onYear,
  onEdit,
}: {
  cal: CalendarRow
  year: number
  onYear: (y: number) => void
  onEdit: () => void
}) {
  const { t, intl, holidayName } = useI18n()
  const { data, isLoading } = useQuery(calendarYearQuery(cal.id, year))
  const [editing, setEditing] = useState<HolidayItem | "new" | null>(null)
  const [importing, setImporting] = useState(false)
  const makeDefault = useAction(() => setDefaultCalendarFn({ data: { id: cal.id } }), {
    success: t("admin.holidays.now_default"),
  })
  const restore = useAction((h: HolidayItem) =>
    saveHolidayFn({
      data: { id: null, calendarId: h.calendarId, date: h.date, name: h.name, fraction: h.fraction === 0.5 ? 0.5 : 1 },
    }),
  )
  const columns = [
    col.accessor("date", {
      header: () => t("common.date"),
      meta: { className: "whitespace-nowrap w-72", mobileLabel: t("common.date") },
      cell: (c) => {
        const wd = parseDay(c.getValue()).getUTCDay()
        // fixed columns: weekday · date · weekend badge always start at the same x; the badge never grows the row
        return (
          <span className="grid grid-cols-[2rem_5.5rem_auto] items-center gap-2 tabular">
            <span className="text-muted-foreground">{fmtDay(c.getValue(), intl, { weekday: "short" })}</span>
            <span>{fmtDay(c.getValue(), intl, { day: "numeric", month: "short" })}</span>
            {wd === 0 || wd === 6 ? (
              <StatusBadge className="h-5 justify-self-start">{t("admin.holidays.weekend")}</StatusBadge>
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
    col.accessor("kind", {
      header: () => t("admin.holidays.kind_col"),
      meta: { mobileLabel: t("admin.holidays.kind_col") },
      cell: (c) => {
        const kind = c.getValue()
        if (!kind) return null
        return kind === "company" ? (
          <StatusBadge tone="info">{t("admin.holidays.kind.company")}</StatusBadge>
        ) : (
          <span className="text-muted-foreground">{t(`admin.holidays.kind.${kind}`)}</span>
        )
      },
    }),
    col.accessor("fraction", {
      header: () => t("admin.holidays.duration"),
      meta: { mobileLabel: t("admin.holidays.duration") },
      cell: (c) =>
        c.getValue() < 1 ? (
          <StatusBadge tone="info">{t("admin.holidays.half_day")}</StatusBadge>
        ) : (
          <span className="text-muted-foreground">{t("admin.holidays.full_day")}</span>
        ),
    }),
  ]
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={cal.name}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold">{cal.name}</h2>
          {cal.regionCode ? (
            <span className="text-sm whitespace-nowrap text-muted-foreground">{cal.regionCode}</span>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onEdit}
                  aria-label={t("admin.holidays.edit_calendar")}
                />
              }
            >
              <Pencil />
            </TooltipTrigger>
            <TooltipContent>{t("admin.holidays.edit_calendar")}</TooltipContent>
          </Tooltip>
          {!cal.isDefault ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => makeDefault.mutate(undefined)}
              disabled={makeDefault.isPending}
            >
              <Star data-icon="inline-start" />
              {t("admin.holidays.make_default")}
            </Button>
          ) : null}
        </div>
        <PeriodNav
          label={String(year)}
          onPrev={() => onYear(year - 1)}
          onNext={() => onYear(year + 1)}
          onToday={() => onYear(currentYear())}
          isCurrent={year === currentYear()}
        />
      </div>
      <PeriodContent>
        <DataTable
          data={data ?? []}
          loading={isLoading}
          columns={columns}
          getRowId={(r) => String(r.id)}
          onRowClick={(r) => setEditing(r)}
          empty={
            <span className="flex flex-col items-center gap-3">
              {t("admin.holidays.none_in_year", { year })}
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Download data-icon="inline-start" />
                {t("admin.holidays.import")}
              </Button>
            </span>
          }
          toolbar={
            <>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Download data-icon="inline-start" />
                {t("admin.holidays.import")}
              </Button>
              <CompanyDaysMenu calendarId={cal.id} year={year} onCustom={() => setEditing("new")} />
            </>
          }
        />
      </PeriodContent>
      {editing ? (
        <HolidaySheet
          calendarId={cal.id}
          year={year}
          holiday={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDeleted={(h) =>
            undoToast(t("admin.holidays.deleted", { name: holidayName(h.name) }), t("common.undo"), () =>
              restore.mutate(h),
            )
          }
        />
      ) : null}
      {importing ? <ImportSheet cal={cal} year={year} onClose={() => setImporting(false)} /> : null}
    </section>
  )
}

/** Optional company days (24/31 Dec afternoon, Berchtoldstag, Zurich customs): one click each, never automatic. */
function CompanyDaysMenu({ calendarId, year, onCustom }: { calendarId: number; year: number; onCustom: () => void }) {
  const { t, intl, holidayName } = useI18n()
  const { data } = useQuery(companyDaysQuery(calendarId, year))
  const add = useAction(
    (key: NonNullable<typeof data>[number]["key"]) => addCompanyDayFn({ data: { calendarId, key, year } }),
    { success: t("admin.holidays.company_day_added") },
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        <Plus data-icon="inline-start" />
        {t("admin.holidays.add_holiday")}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {(data ?? []).map((d) => (
          <DropdownMenuItem key={d.key} disabled={d.added || add.isPending} onClick={() => add.mutate(d.key)}>
            {d.added ? <Check /> : <CalendarPlus />}
            <span className="flex-1 truncate">
              {holidayName(d.name)}
              {d.fraction < 1 ? " ½" : ""}
            </span>
            <span className="text-xs text-muted-foreground tabular">
              {fmtDay(d.date, intl, { day: "numeric", month: "short" })}
            </span>
          </DropdownMenuItem>
        ))}
        {data?.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onClick={onCustom}>
          <Pencil />
          {t("admin.holidays.custom_day")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
