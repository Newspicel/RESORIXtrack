import { StatusBadge } from "@/components/app/status-badge"
import { tableHelper } from "@/components/data/table-helper"
import { fmtDay, parseDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"

export interface HolidayRow {
  date: string
  name: string
  fraction: number
  kind?: "federal" | "cantonal" | "company" | null
}

/** Date, name, kind and duration: the holiday table of the admin calendars and of "Public holidays". */
export function useHolidayColumns<T extends HolidayRow>() {
  const { t, intl, holidayName } = useI18n()
  const col = tableHelper<T>()
  return [
    col.accessor((r) => r.date, {
      id: "date",
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
              <StatusBadge className="h-5 justify-self-start">{t("admin.holidays.weekend")}</StatusBadge>
            ) : null}
          </span>
        )
      },
    }),
    col.accessor((r) => r.name, {
      id: "name",
      header: () => t("common.name"),
      meta: { primary: true },
      cell: (c) => holidayName(c.getValue()),
    }),
    col.accessor((r) => r.kind ?? null, {
      id: "kind",
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
    col.accessor((r) => r.fraction, {
      id: "fraction",
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
}
