/** The person's own year or month calendar: holidays, days off and absences by type. */
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { AbsenceCalendar, CalendarLegend } from "@/components/app/absence-calendar"
import { cellsFrom } from "@/components/app/absence-calendar-cells"
import { Section } from "@/components/app/page"
import { PeriodContent, PeriodNav } from "@/components/app/period-nav"
import { Segmented } from "@/components/app/segmented"
import { Skeleton } from "@/components/ui/skeleton"
import { addMonthsStr, fmtMonth } from "@/lib/format"

import { useI18n } from "@/lib/i18n"
import { calendarDaysQuery } from "./api"
import { shortLabel } from "./lib"

const CALENDAR_VIEWS = ["year", "month"] as const
type CalendarView = (typeof CALENDAR_VIEWS)[number]

export function OwnCalendar({
  userId,
  year,
  today,
  view,
  month,
  onView,
  onMonth,
  onOpenAbsence,
  onRequest,
}: {
  userId?: number | null
  year: number
  today: string
  view: CalendarView
  month: string
  onView: (view: CalendarView) => void
  onMonth: (month: string) => void
  onOpenAbsence: (id: number) => void
  onRequest?: (date: string) => void
}) {
  const { t, intl, absenceLabel } = useI18n()
  const [active, setActive] = useState<string | null>(null)
  const q = useQuery({
    ...calendarDaysQuery({ userId: userId ?? null, from: `${year}-01-01`, to: `${year}-12-31` }),
    placeholderData: keepPreviousData,
  })
  const days = q.data ?? []
  const cells = cellsFrom(days, (a) => {
    const label = absenceLabel({ key: a.typeKey, label: a.label })
    return {
      key: String(a.id),
      color: a.color,
      text: shortLabel(label),
      label: `${label}${a.halves.length === 1 ? `, ${t(`absences.half.${a.halves[0]}`)}` : ""}${a.status === "pending" ? ` (${t("absences.status.pending")})` : ""}`,
      pending: a.status === "pending",
      half: a.halves.length === 1 ? a.halves[0] : null,
    }
  })
  const types = new Map<string, { key: string; color: string; label: string }>()
  for (const d of days)
    for (const a of d.absences)
      types.set(a.typeKey, { key: a.typeKey, color: a.color, label: absenceLabel({ key: a.typeKey, label: a.label }) })

  const byDate = new Map(days.map((d) => [d.date, d]))
  const select = (date: string) => {
    const first = byDate.get(date)?.absences[0]
    if (first) onOpenAbsence(first.id)
    else onRequest?.(date)
  }
  const months = Array.from({ length: 12 }, (_, m) => `${year}-${String(m + 1).padStart(2, "0")}`)

  return (
    <Section
      title={t("absences.calendar")}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {view === "month" ? (
            <PeriodNav
              label={fmtMonth(month, intl)}
              onPrev={() => onMonth(addMonthsStr(month, -1))}
              onNext={() => onMonth(addMonthsStr(month, 1))}
              onToday={() => onMonth(today.slice(0, 7))}
              isCurrent={month === today.slice(0, 7)}
            />
          ) : null}
          <Segmented
            value={view}
            onValueChange={onView}
            aria-label={t("absences.calendar")}
            options={CALENDAR_VIEWS.map((v) => ({ value: v, label: t(`absences.view.${v}`) }))}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-3 sm:p-5">
        <PeriodContent>
          {q.isPending ? (
            <Skeleton className="h-72 w-full" />
          ) : view === "month" ? (
            <AbsenceCalendar month={month} days={cells} today={today} onSelect={select} onMonthChange={onMonth} />
          ) : (
            <div data-cal-scope className="grid grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-6 lg:grid-cols-3 xl:grid-cols-4">
              {months.map((m) => (
                <AbsenceCalendar
                  key={m}
                  month={m}
                  days={cells}
                  today={today}
                  size="sm"
                  caption
                  active={active ?? (today.startsWith(`${year}-`) ? today : `${year}-01-01`)}
                  onActiveChange={setActive}
                  onSelect={select}
                />
              ))}
            </div>
          )}
        </PeriodContent>
        <CalendarLegend types={[...types.values()]} />
      </div>
    </Section>
  )
}
