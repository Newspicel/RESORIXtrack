import { fmtDateTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { Json } from "@/lib/json"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { AuditItem } from "@/server/services/admin-logs"
import { EditorSheet } from "../ui"

const show = (v: Json | undefined) =>
  v == null || v === "" ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v)

/** Full before/after of one change-log entry. */
export function AuditDetail({ item, onClose }: { item: AuditItem; onClose: () => void }) {
  const { t, has, intl } = useI18n()
  const me = useMe()
  const keys = [...new Set([...Object.keys(item.before ?? {}), ...Object.keys(item.after ?? {})])]
  const changedKeys = new Set(item.changed)
  const label = (k: string) => (has(`admin.audit.fields.${k}`) ? t(`admin.audit.fields.${k}`) : k)
  const meta: [string, string][] = [
    [t("admin.audit.when"), fmtDateTime(item.at, { intl, tz: me.timezone, hour12: me.timeFormat === "12h" })],
    [t("admin.audit.person"), item.subject ?? "–"],
    [t("admin.audit.by"), item.actor ?? t("admin.audit.system")],
    [t("admin.audit.source"), item.source],
    [t("common.reason"), item.reason || "–"],
  ]
  return (
    <EditorSheet
      open
      size="xl"
      onOpenChange={(o) => !o && onClose()}
      title={`${has(`admin.audit.entities.${item.entity}`) ? t(`admin.audit.entities.${item.entity}`) : item.entity} #${item.entityId} · ${has(`admin.audit.actions.${item.action}`) ? t(`admin.audit.actions.${item.action}`) : item.action}`}
    >
      <div className="flex flex-col gap-6">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {keys.length ? (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs tracking-wide text-muted-foreground uppercase">
                  <th className="px-3 py-2 font-medium">{t("admin.audit.field")}</th>
                  <th className="px-3 py-2 font-medium">{t("admin.audit.before")}</th>
                  <th className="px-3 py-2 font-medium">{t("admin.audit.after")}</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const changed = changedKeys.has(k)
                  return (
                    <tr key={k} className={cn("border-b last:border-0", changed && "bg-brand-soft")}>
                      <td className="px-3 py-2 text-muted-foreground">{label(k)}</td>
                      <td className="px-3 py-2 break-all tabular">{show(item.before?.[k])}</td>
                      <td className="px-3 py-2 break-all tabular">{show(item.after?.[k])}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </EditorSheet>
  )
}
