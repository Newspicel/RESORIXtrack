/**
 * Labour-law findings (compliance.ts) as a table: when, rule, severity, value against the limit, and the
 * legal reference. Used by the compliance report and the member page.
 */
import { StatusBadge, type Tone } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { fmtDay, fmtMinutes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { Finding } from "@/server/services/compliance"

export interface FindingRow extends Finding {
  person?: string
}

const DAY_RULES = new Set(["consecutive_days", "vacation_minimum", "vacation_block"])
const TONE: Record<Finding["severity"], Tone> = { violation: "negative", warning: "warning", info: "info" }
const ICON = { violation: "warning", warning: "warning", info: "info" } as const

export function SeverityBadge({ severity }: { severity: Finding["severity"] }) {
  const { t } = useI18n()
  return (
    <StatusBadge tone={TONE[severity]} icon={ICON[severity]}>
      {t(`compliance.severity.${severity}`)}
    </StatusBadge>
  )
}

export function useFindingFormat() {
  const { t, intl } = useI18n()
  return {
    when: (f: Pick<Finding, "date" | "week" | "year">) =>
      f.date
        ? fmtDay(f.date, intl, { weekday: "short", day: "numeric", month: "short" })
        : f.week
          ? t("reports.week_of", { date: fmtDay(f.week, intl) })
          : String(f.year ?? ""),
    amount: (f: Pick<Finding, "rule">, v: number) =>
      DAY_RULES.has(f.rule) ? t("reports.n_days", { count: Math.round(v * 10) / 10 }) : fmtMinutes(v),
  }
}

const col = tableHelper<FindingRow>()

export function FindingsTable({
  rows,
  showPerson,
  empty,
}: {
  rows: FindingRow[]
  showPerson?: boolean
  empty?: string
}) {
  const { t } = useI18n()
  const fmt = useFindingFormat()
  const columns = [
    ...(showPerson
      ? [
          col.accessor((r) => r.person ?? "", {
            id: "person",
            header: () => t("reports.person"),
            meta: { primary: true },
          }),
        ]
      : []),
    col.accessor((r) => r.date ?? r.week ?? String(r.year ?? ""), {
      id: "when",
      header: () => t("reports.when"),
      meta: { primary: !showPerson, mobileLabel: t("reports.when"), className: "whitespace-nowrap" },
      cell: (c) => fmt.when(c.row.original),
    }),
    col.accessor((r) => t(`compliance.rule.${r.rule}`), {
      id: "rule",
      header: () => t("reports.rule"),
      meta: { mobileLabel: t("reports.rule") },
    }),
    col.accessor("severity", {
      header: () => t("reports.severity"),
      meta: { mobileLabel: t("reports.severity") },
      sortFn: "basic",
      cell: (c) => <SeverityBadge severity={c.getValue()} />,
    }),
    col.accessor("value", {
      header: () => t("reports.value_limit"),
      meta: { numeric: true, mobileLabel: t("reports.value_limit") },
      cell: (c) => (
        <span className="whitespace-nowrap">
          {fmt.amount(c.row.original, c.getValue())}
          <span className="text-muted-foreground"> / {fmt.amount(c.row.original, c.row.original.limit)}</span>
        </span>
      ),
    }),
    col.accessor("ref", {
      header: () => t("reports.ref"),
      enableSorting: false,
      meta: { mobileLabel: t("reports.ref"), className: "whitespace-nowrap text-muted-foreground" },
    }),
  ]
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r, i) => `${i}-${r.rule}`}
      search={rows.length > 10}
      pageSize={25}
      empty={empty ?? t("compliance.none")}
    />
  )
}
