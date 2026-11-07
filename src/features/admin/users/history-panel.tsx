import { useSuspenseQuery } from "@tanstack/react-query"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { fmtDateTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { userHistory } from "@/server/services/users"
import { userHistoryQuery } from "../api/users"
import { ChangeList } from "../logs/change-list"

type Item = ReturnType<typeof userHistory>[number]
const col = tableHelper<Item>()

export function HistoryPanel({ userId }: { userId: number }) {
  const { t, intl, has } = useI18n()
  const me = useMe()
  const { data } = useSuspenseQuery(userHistoryQuery(userId))
  const columns = [
    col.accessor("at", {
      header: () => t("admin.audit.when"),
      meta: { primary: true, className: "whitespace-nowrap" },
      cell: (c) => fmtDateTime(c.getValue(), { intl, tz: me.timezone, hour12: me.timeFormat === "12h" }),
    }),
    col.accessor((r) => `${r.entity}.${r.action}`, {
      id: "what",
      header: () => t("admin.audit.what"),
      meta: { mobileLabel: t("admin.audit.what") },
      cell: (c) => (
        <span>
          {t(`admin.audit.entities.${c.row.original.entity}`)}{" "}
          <span className="text-muted-foreground">
            {has(`admin.audit.actions.${c.row.original.action}`)
              ? t(`admin.audit.actions.${c.row.original.action}`)
              : c.row.original.action}
          </span>
        </span>
      ),
    }),
    col.accessor((r) => r.actor ?? "", {
      id: "actor",
      header: () => t("admin.audit.by"),
      meta: { mobileLabel: t("admin.audit.by") },
      cell: (c) => c.getValue() || <span className="text-muted-foreground">{t("admin.audit.system")}</span>,
    }),
    col.display({
      id: "changes",
      header: () => t("admin.audit.changes"),
      meta: { mobileLabel: t("admin.audit.changes") },
      cell: (c) => <ChangeList item={c.row.original} />,
    }),
  ]
  return (
    <DataTable
      data={data}
      columns={columns}
      getRowId={(r) => String(r.id)}
      empty={t("admin.audit.none")}
      pageSize={25}
    />
  )
}
