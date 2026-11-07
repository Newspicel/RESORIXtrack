import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { LogOut, Unlink } from "lucide-react"
import { toast } from "sonner"
import { Section } from "@/components/app/page"
import { RelativeTime } from "@/components/app/relative-time"
import { SettingRow, SettingsGroup } from "@/components/app/settings"
import { StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { Button } from "@/components/ui/button"
import { fmtDateTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import {
  endOtherSessions,
  endSession,
  type fetchLoginHistory,
  type fetchSessions,
  loginHistoryQuery,
  securityQuery,
  sessionsQuery,
  unlinkSignInProvider,
} from "./api"

type SessionRow = Awaited<ReturnType<typeof fetchSessions>>[number]
type AttemptRow = Awaited<ReturnType<typeof fetchLoginHistory>>[number]
const sCol = tableHelper<SessionRow>()
const aCol = tableHelper<AttemptRow>()

export function SessionsSection() {
  const { t, tError } = useI18n()
  const qc = useQueryClient()
  const { data } = useSuspenseQuery(sessionsQuery)
  const refresh = () => qc.invalidateQueries({ queryKey: ["profile", "sessions"] })
  const columns = [
    sCol.accessor("device", {
      header: () => t("profile.device"),
      meta: { primary: true },
      cell: (c) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{c.getValue()}</span>
          {c.row.original.current ? <StatusBadge tone="brand">{t("profile.this_device")}</StatusBadge> : null}
        </span>
      ),
    }),
    sCol.accessor((r) => r.ip || "–", {
      id: "ip",
      header: () => t("profile.ip"),
      meta: { mobileLabel: t("profile.ip"), className: "text-muted-foreground tabular" },
    }),
    sCol.accessor("lastActiveAt", {
      header: () => t("profile.last_active"),
      meta: { mobileLabel: t("profile.last_active"), className: "text-muted-foreground whitespace-nowrap" },
      cell: (c) => <RelativeTime at={c.getValue()} />,
    }),
    sCol.display({
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: (c) =>
        c.row.original.current ? null : (
          <Button
            variant="ghost"
            size="sm"
            intent="negative"
            onClick={async (e) => {
              e.stopPropagation()
              try {
                await endSession({ data: { id: c.row.original.id } })
                toast.success(t("profile.signed_out"))
              } catch (err) {
                toast.error(tError(err))
              }
              await refresh()
            }}
          >
            <LogOut data-icon="inline-start" />
            {t("profile.sign_out")}
          </Button>
        ),
    }),
  ]
  const others = data.filter((s) => !s.current).length
  return (
    <Section
      title={t("profile.sessions")}
      actions={
        others > 0 ? (
          <Button
            variant="outline"
            intent="negative"
            onClick={async () => {
              await endOtherSessions()
              toast.success(t("profile.signed_out"))
              await refresh()
            }}
          >
            {t("profile.sign_out_others")}
          </Button>
        ) : null
      }
    >
      <DataTable
        data={data}
        columns={columns}
        getRowId={(r) => String(r.id)}
        caption={t("profile.sessions")}
        empty={t("common.empty")}
      />
    </Section>
  )
}

export function ProvidersSection() {
  const { t, intl, tError } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const { data } = useSuspenseQuery(securityQuery)
  if (!data.providers.length) return null
  return (
    <SettingsGroup title={t("profile.sign_in_methods")}>
      {data.providers.map((p) => (
        <SettingRow
          key={p.id}
          inline
          label={p.name}
          hint={t("profile.linked_since", { date: fmtDateTime(p.linkedAt, { intl, tz: me.timezone }) })}
          control={
            p.canUnlink ? (
              <Button
                variant="ghost"
                intent="negative"
                onClick={async () => {
                  try {
                    await unlinkSignInProvider({ data: { id: p.id } })
                    toast.success(t("profile.unlinked"))
                  } catch (err) {
                    toast.error(tError(err))
                  }
                  await qc.invalidateQueries({ queryKey: ["profile"] })
                }}
              >
                <Unlink data-icon="inline-start" />
                {t("profile.unlink")}
              </Button>
            ) : null
          }
        />
      ))}
    </SettingsGroup>
  )
}

export function LoginHistorySection() {
  const { t, intl } = useI18n()
  const me = useMe()
  const { data } = useSuspenseQuery(loginHistoryQuery)
  const columns = [
    aCol.accessor("at", {
      header: () => t("common.time"),
      meta: { primary: true, className: "whitespace-nowrap" },
      cell: (c) => fmtDateTime(c.getValue(), { intl, tz: me.timezone, hour12: me.timeFormat === "12h" }),
    }),
    aCol.accessor("reason", {
      header: () => t("common.status"),
      meta: { mobileLabel: t("common.status") },
      cell: (c) => (
        <StatusBadge
          tone={c.row.original.success ? "positive" : "negative"}
          icon={c.row.original.success ? null : "warning"}
        >
          {t(`profile.login_reason.${c.getValue()}`)}
        </StatusBadge>
      ),
    }),
    aCol.accessor("device", { header: () => t("profile.device"), meta: { mobileLabel: t("profile.device") } }),
    aCol.accessor((r) => r.ip || "–", {
      id: "ip",
      header: () => t("profile.ip"),
      meta: { mobileLabel: t("profile.ip"), className: "text-muted-foreground tabular" },
    }),
  ]
  return (
    <Section title={t("profile.login_history")}>
      <DataTable
        data={data}
        columns={columns}
        getRowId={(r) => String(r.id)}
        pageSize={10}
        caption={t("profile.login_history")}
        empty={t("profile.no_logins")}
      />
    </Section>
  )
}
