import { fmtDay } from "@/lib/format"

/** "12 Jul – 24 Jul 2026", "from 1 Jan 2026", "until …" or "open-ended". */
export function fmtPeriod(
  from: string | null,
  to: string | null,
  intl: string,
  t: (k: string, v?: Record<string, string>) => string,
): string {
  const d = (x: string) => fmtDay(x, intl, { day: "numeric", month: "short", year: "numeric" })
  if (from && to) return `${d(from)} – ${d(to)}`
  if (from) return t("admin.teams.from_date", { date: d(from) })
  if (to) return t("admin.teams.until_date", { date: d(to) })
  return t("admin.teams.open_ended")
}
