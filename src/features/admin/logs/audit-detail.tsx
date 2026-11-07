import { Fragment, type ReactNode } from "react"
import { fmtDateTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { AuditItem } from "@/server/services/admin-logs"
import { EditorSheet } from "../ui"
import { useAuditFormat } from "./change-list"

/** Muted label left, value right, like the absence panel. */
function DetailList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2.5 text-sm">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

/**
 * One change-log entry: who, when, why, and the fields. A creation lists the new values, a deletion the old
 * ones, an update only what changed (old → new). Values are shown as people read them, not as stored.
 */
export function AuditDetail({ item, onClose }: { item: AuditItem; onClose: () => void }) {
  const { t, has, intl } = useI18n()
  const me = useMe()
  const { label, value, reason } = useAuditFormat()
  const hour12 = me.timeFormat === "12h"

  const before = item.before ?? {}
  const after = item.after ?? {}
  const all = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const changed = item.changed.length ? item.changed : all
  const rows: [string, ReactNode][] =
    item.before && item.after
      ? changed.map((k) => [
          label(k),
          <span key={k} className="tabular">
            <span className="text-muted-foreground line-through decoration-muted-foreground/50">
              {value(k, before[k])}
            </span>
            <span className="px-1.5 text-muted-foreground" aria-hidden>
              →
            </span>
            <span className="sr-only">{t("admin.audit.after")}: </span>
            {value(k, after[k])}
          </span>,
        ])
      : all.map((k) => [
          label(k),
          <span key={k} className="tabular">
            {value(k, item.after ? after[k] : before[k])}
          </span>,
        ])

  const entity = has(`admin.audit.entities.${item.entity}`) ? t(`admin.audit.entities.${item.entity}`) : item.entity
  const action = has(`admin.audit.actions.${item.action}`) ? t(`admin.audit.actions.${item.action}`) : item.action
  const meta: [string, ReactNode][] = [
    [t("admin.audit.when"), fmtDateTime(item.at, { intl, tz: me.timezone, hour12 })],
    [t("admin.audit.person"), item.subject ?? ""],
    [t("admin.audit.by"), item.actor ?? t("admin.audit.system")],
    [t("admin.audit.source"), value("source", item.source)],
    [t("common.reason"), reason(item.reason)],
  ]
  return (
    <EditorSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${entity} · ${action}`}
      description={`#${item.entityId}`}
    >
      <div className="flex flex-col gap-6">
        <DetailList rows={meta.filter(([, v]) => v !== "")} />
        {rows.length ? (
          <section className="flex flex-col gap-3 border-t pt-5">
            <h3 className="text-sm font-medium">{t("admin.audit.changes")}</h3>
            <DetailList rows={rows} />
          </section>
        ) : null}
      </div>
    </EditorSheet>
  )
}
