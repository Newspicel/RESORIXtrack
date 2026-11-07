import { fmtDay, fmtMinutes, fmtMonth } from "@/lib/format"
import type { I18n, Vars } from "@/lib/i18n-core"
import type { JsonObject } from "@/lib/json"

export type Notification = { id: number; kind: string; payload: JsonObject; read: boolean; createdAt: string }

/** Payload values that can be interpolated (strings and numbers). */
function scalars(payload: JsonObject): Record<string, string | number | undefined> {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(payload)) if (typeof v === "string" || typeof v === "number") out[k] = v
  return out
}

export function notificationText(n: Notification, myId: number, myName: string, i: I18n): string {
  const p = scalars(n.payload)
  let kind = n.kind
  if (kind === "absence_cancelled" && p.user_id === myId)
    kind = p.actor_id === myId || p.actor_name === myName ? "absence_cancelled_own" : "absence_cancelled_yours"
  const vars: Vars = { ...p, type: i.absenceLabel(String(p.type_key ?? p.type ?? "")) }
  for (const k of ["start_date", "end_date"]) {
    const day = p[k]
    if (typeof day === "string") vars[k] = fmtDay(day, i.intl)
  }
  if (typeof p.month === "string" && /^\d{4}-\d{2}$/.test(p.month)) vars.month = fmtMonth(p.month, i.intl)
  if (p.account === "time" || p.account === "vacation") vars.account = i.t(`notifications.account_${p.account}`)
  if (kind === "lead_assigned") {
    vars.role = i.t(`notifications.role_${p.role}`)
    vars.period =
      p.valid_from || p.valid_to
        ? `${p.valid_from ? fmtDay(String(p.valid_from), i.intl) : "…"} – ${p.valid_to ? fmtDay(String(p.valid_to), i.intl) : "…"}`
        : i.t("notifications.period_open")
  }
  if (typeof p.amount === "number")
    vars.amount = p.account === "vacation" ? String(p.amount) : fmtMinutes(p.amount, { sign: true })
  return i.t(`notifications.${kind}`, vars)
}

export function notificationHref(
  n: Notification,
  myId: number,
): { to: string; search?: Record<string, string | number> } {
  const p = scalars(n.payload)
  if (n.kind.startsWith("entry_"))
    return n.kind === "entry_disputed" ? { to: `/team/member/${p.actor_id}` } : { to: "/time" }
  if (n.kind === "absence_requested" || (n.kind === "absence_cancelled" && p.user_id && p.user_id !== myId))
    return { to: "/team/approvals" }
  if (n.kind === "absence_reported") return { to: "/team" }
  if (n.kind.startsWith("absence_") || n.kind === "attachment_added") return { to: "/absences" }
  if (n.kind === "balance_adjusted") return { to: "/account" }
  if (n.kind === "month_signed_off") return { to: "/time", search: { view: "month", date: `${p.month}-01` } }
  if (n.kind === "month_reopened")
    return p.user_id && p.user_id !== myId
      ? { to: "/team/signoff" }
      : { to: "/time", search: { view: "month", date: `${p.month}-01` } }
  if (n.kind === "token_revoked" || n.kind === "mfa_reset" || n.kind === "passkeys_removed") return { to: "/profile" }
  if (n.kind === "lead_assigned") return { to: "/team" }
  if (n.kind === "holidays_topped_up" || n.kind === "holidays_missing")
    return { to: "/admin/holidays", search: { cal: Number(p.calendar_id), year: Number(p.year) } }
  return { to: "/" }
}
