import { Link } from "@tanstack/react-router"
import { StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { StatCard, StatGrid } from "@/components/data/stat"
import { tableHelper } from "@/components/data/table-helper"
import { Progress } from "@/components/ui/progress"
import { fmtMinutes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { ComplianceReportData } from "./compliance-report"
import { type FindingRow, FindingsTable } from "./findings"

type Row = ComplianceReportData["rows"][number]
const col = tableHelper<Row>()

function Count({ n, tone }: { n: number; tone: "negative" | "warning" | "info" }) {
  if (!n) return <span className="text-muted-foreground">–</span>
  return (
    <StatusBadge tone={tone} className="tabular">
      {n}
    </StatusBadge>
  )
}

/** Überzeit of the year against the legal limit (170 h / 140 h), warning from 80 %. */
export function OvertimeMeter({ o }: { o: Row["overtime"] }) {
  const share = o.limitMin ? o.overtimeMin / o.limitMin : 0
  return (
    <div className="flex min-w-32 flex-col gap-1">
      <span
        className={cn(
          "tabular",
          o.overtimeMin > o.limitMin ? "text-negative" : o.overtimeMin >= o.warnAtMin ? "text-warning" : undefined,
        )}
      >
        {fmtMinutes(o.overtimeMin)}
        <span className="text-muted-foreground"> / {fmtMinutes(o.limitMin)}</span>
      </span>
      <Progress value={Math.min(1, share) * 100} className="h-1" aria-hidden />
    </div>
  )
}

export function CompliancePreview({ d }: { d: ComplianceReportData }) {
  const { t } = useI18n()
  const totals = d.rows.reduce(
    (acc, r) => ({
      violation: acc.violation + r.counts.violation,
      warning: acc.warning + r.counts.warning,
      info: acc.info + r.counts.info,
    }),
    { violation: 0, warning: 0, info: 0 },
  )
  const columns = [
    col.accessor("name", {
      header: () => t("common.name"),
      meta: { primary: true },
      cell: (c) => (
        <Link
          to="/team/member/$userId"
          params={{ userId: c.row.original.userId }}
          search={{ tab: "compliance" }}
          className="font-medium hover:underline"
        >
          {c.getValue()}
        </Link>
      ),
    }),
    col.accessor((r) => r.team ?? "", {
      id: "team",
      header: () => t("common.team"),
      meta: { hideOnMobile: true, className: "text-muted-foreground" },
    }),
    col.accessor((r) => r.counts.violation, {
      id: "violation",
      header: () => t("compliance.severity.violation"),
      meta: { numeric: true, mobileLabel: t("compliance.severity.violation") },
      cell: (c) => <Count n={c.getValue()} tone="negative" />,
    }),
    col.accessor((r) => r.counts.warning, {
      id: "warning",
      header: () => t("compliance.severity.warning"),
      meta: { numeric: true, mobileLabel: t("compliance.severity.warning") },
      cell: (c) => <Count n={c.getValue()} tone="warning" />,
    }),
    col.accessor((r) => r.counts.info, {
      id: "info",
      header: () => t("compliance.severity.info"),
      meta: { numeric: true, mobileLabel: t("compliance.severity.info") },
      cell: (c) => <Count n={c.getValue()} tone="info" />,
    }),
    col.accessor((r) => r.overtime.overtimeMin, {
      id: "overtime",
      header: () => t("compliance.ueberzeit_year", { year: d.year }),
      meta: { mobileLabel: t("compliance.ueberzeit_year", { year: d.year }) },
      cell: (c) => <OvertimeMeter o={c.row.original.overtime} />,
    }),
  ]
  const findings: FindingRow[] = d.rows.flatMap((r) => r.findings.map((f) => ({ ...f, person: r.name })))
  return (
    <div className="flex flex-col gap-6">
      <StatGrid className="lg:grid-cols-3">
        <StatCard
          label={t("compliance.severity.violation")}
          value={totals.violation}
          tone={totals.violation ? "negative" : "default"}
        />
        <StatCard label={t("compliance.severity.warning")} value={totals.warning} />
        <StatCard label={t("compliance.severity.info")} value={totals.info} className="col-span-2 lg:col-span-1" />
      </StatGrid>
      <DataTable
        data={d.rows}
        columns={columns}
        getRowId={(r) => String(r.userId)}
        initialSorting={[{ id: "violation", desc: true }]}
        empty={t("reports.nobody")}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("reports.findings")}</h2>
        <FindingsTable rows={findings} showPerson />
      </section>
    </div>
  )
}
