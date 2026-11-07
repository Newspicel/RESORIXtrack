import { Send } from "lucide-react"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import type { smtpStatus } from "@/server/services/admin-settings"
import { sendTestMailFn } from "../api/settings"
import { useAction } from "../ui"

export function EmailSection({ smtp }: { smtp: ReturnType<typeof smtpStatus> }) {
  const { t } = useI18n()
  const test = useAction(() => sendTestMailFn(), {
    success: (r) => t("admin.email.sent", { to: r.to }),
    invalidate: [],
  })
  const rows: [string, string][] = [
    [t("admin.email.host"), smtp.host ? `${smtp.host}:${smtp.port}` : "–"],
    [t("admin.email.security"), smtp.security],
    [t("admin.email.user"), smtp.user || "–"],
    [t("admin.email.from"), smtp.from],
  ]
  return (
    <Section
      title={t("admin.email.title")}
      actions={
        smtp.configured ? (
          <StatusBadge tone="positive" icon="approved">
            {t("admin.email.configured")}
          </StatusBadge>
        ) : (
          <StatusBadge tone="warning" icon="warning">
            {t("admin.email.not_configured")}
          </StatusBadge>
        )
      }
    >
      <dl className="grid divide-y rounded-xl border bg-card">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 px-4 py-3 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate font-mono text-[13px]">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">{t("admin.email.env_hint")}</p>
      <div>
        <Button variant="outline" onClick={() => test.mutate(undefined)} disabled={test.isPending || !smtp.configured}>
          <Send data-icon="inline-start" />
          {t("admin.email.send_test")}
        </Button>
      </div>
    </Section>
  )
}
