import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { API_KEY_STATUSES, allApiKeysQuery, apiKeyFilters } from "@/features/admin/api/api-keys"
import { auditFilters, auditQuery, backupsQuery, loginFilters, loginsQuery } from "@/features/admin/api/logs"
import { userRefsQuery } from "@/features/admin/api/users"
import { LogsPage } from "@/features/admin/logs/logs-page"
import { LOG_TABS } from "@/features/admin/search"

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const search = z.object({
  tab: z.enum(LOG_TABS).optional().catch(undefined),
  user: z.coerce.number().int().positive().optional().catch(undefined),
  entity: z.string().max(32).optional().catch(undefined),
  action: z.string().max(32).optional().catch(undefined),
  q: z.string().max(254).optional().catch(undefined),
  result: z.enum(["ok", "failed"]).optional().catch(undefined),
  status: z.enum(API_KEY_STATUSES).optional().catch(undefined),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
})
type Search = z.infer<typeof search>

function toAudit(s: Search) {
  return auditFilters.parse({
    userId: s.user ?? null,
    entity: s.entity ?? null,
    action: s.action ?? null,
    from: s.from ?? null,
    to: s.to ?? null,
  })
}
function toLogins(s: Search) {
  return loginFilters.parse({
    q: s.q ?? null,
    success: s.result ? s.result === "ok" : null,
    from: s.from ?? null,
    to: s.to ?? null,
  })
}

function toKeys(s: Search) {
  return apiKeyFilters.parse({ status: s.status ?? "all", page: s.page ?? 1 })
}

export const Route = createFileRoute("/_app/admin/backups")({
  staticData: { titleKey: "nav.backups" },
  validateSearch: search,
  loaderDeps: ({ search: s }) => s,
  loader: async ({ context, deps, cause }) => {
    const tab = deps.tab ?? "backups"
    const qc = context.queryClient
    const load = Promise.all([
      tab === "backups" ? qc.ensureQueryData(backupsQuery) : null,
      tab === "audit" ? qc.ensureQueryData(userRefsQuery) : null,
      tab === "audit" ? qc.ensureInfiniteQueryData(auditQuery(toAudit(deps))) : null,
      tab === "logins" ? qc.ensureInfiniteQueryData(loginsQuery(toLogins(deps))) : null,
      tab === "keys" ? qc.ensureQueryData(allApiKeysQuery(toKeys(deps))) : null,
    ])
    // on entry the active tab is awaited (server render); a filter change commits at once and the tab keeps
    // its rows until the next ones are ready
    if (cause !== "stay") await load
    else void load.catch(() => undefined)
  },
  component: LogsRoute,
})

const opt = <T,>(v: T | null) => v ?? undefined

function LogsRoute() {
  const s = Route.useSearch()
  const navigate = Route.useNavigate()
  const go = (next: Search) => navigate({ search: next, replace: true, resetScroll: false })
  // filters belong to the active tab (switching tabs clears them); hidden tabs pre-render their defaults
  const active = s.tab ?? "backups"
  const audit = toAudit(active === "audit" ? s : {})
  const logins = toLogins(active === "logins" ? s : {})
  const keys = toKeys(active === "keys" ? s : {})
  return (
    <LogsPage
      tab={active}
      onTab={(tab) => go({ tab: tab === "backups" ? undefined : tab })}
      audit={audit}
      onAudit={(f) =>
        go({
          tab: "audit",
          user: opt(f.userId),
          entity: opt(f.entity),
          action: opt(f.action),
          from: opt(f.from),
          to: opt(f.to),
        })
      }
      logins={logins}
      onLogins={(f) =>
        go({
          tab: "logins",
          q: opt(f.q),
          result: f.success == null ? undefined : f.success ? "ok" : "failed",
          from: opt(f.from),
          to: opt(f.to),
        })
      }
      keys={keys}
      onKeys={(f) =>
        go({
          tab: "keys",
          status: f.status === "all" ? undefined : f.status,
          page: f.page > 1 ? f.page : undefined,
        })
      }
    />
  )
}
