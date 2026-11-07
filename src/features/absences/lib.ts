/** Client helpers for absences: half-day labels, date ranges, the range picker and list grouping. */
import { addDaysStr, fmtDay, fmtDayRange } from "@/lib/format"
import type { I18n } from "@/lib/i18n-core"
import type { AbsenceDto } from "@/server/services/absences"

export const HALVES = ["full", "am", "pm"] as const
export type Half = (typeof HALVES)[number]
export type AbsenceStatus = AbsenceDto["status"]

export interface Span {
  startDate: string
  endDate: string
  startHalf: Half
  endHalf: Half
}

const DAY: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }
const DAY_YEAR: Intl.DateTimeFormatOptions = { ...DAY, year: "numeric" }

/** With `today`, the year shows only outside the current one (shared month and year once, at the end). "Mon 7 Dec" or "Mon 7 Dec, Morning" or "Mon 7 Dec (afternoon) – Fri 11 Dec (morning)". */
export function formatSpan(
  a: Span,
  i: Pick<I18n, "t" | "intl">,
  opts: { year?: boolean; today?: string } = {},
): string {
  const y = opts.today?.slice(0, 4)
  const f = opts.year || (y && (!a.startDate.startsWith(y) || !a.endDate.startsWith(y))) ? DAY_YEAR : DAY
  if (a.startDate === a.endDate) {
    const day = fmtDay(a.startDate, i.intl, f)
    return a.startHalf === "full" ? day : `${day}, ${i.t(`absences.half.${a.startHalf}`)}`
  }
  if (a.startHalf === "full" && a.endHalf === "full") {
    // "Mo., 18. – Mi., 20. Jan. 2027": shared month and year show once
    return fmtDayRange(a.startDate, a.endDate, i.intl, f)
  }
  // within one year the year shows once, at the end
  const start = fmtDay(
    a.startDate,
    i.intl,
    f === DAY_YEAR && a.startDate.slice(0, 4) === a.endDate.slice(0, 4) ? DAY : f,
  )
  const sh = a.startHalf === "pm" ? ` (${i.t("absences.half.pm").toLowerCase()})` : ""
  const eh = a.endHalf === "am" ? ` (${i.t("absences.half.am").toLowerCase()})` : ""
  return `${start}${sh} – ${fmtDay(a.endDate, i.intl, f)}${eh}`
}

/**
 * Range picking on a calendar: with no anchor (or a day before it) the click starts a new range and
 * becomes the anchor; a later day ends the range.
 */
export function nextRange(anchor: string | null, day: string): { start: string; end: string; anchor: string | null } {
  if (anchor && day >= anchor) return { start: anchor, end: day, anchor: null }
  return { start: day, end: day, anchor: day }
}

/** The next Monday to Friday after `d`. */
export function nextWeekday(d: string): string {
  let x = addDaysStr(d, 1)
  while ([0, 6].includes(new Date(`${x}T12:00:00Z`).getUTCDay())) x = addDaysStr(x, 1)
  return x
}

/** Halves as the service stores them: a single day uses only the start half; multi-day starts full|pm, ends full|am. */
export function normalizeHalves(
  start: string,
  end: string,
  startHalf: Half,
  endHalf: Half,
): { startHalf: Half; endHalf: Half } {
  if (start === end) return { startHalf, endHalf: "full" }
  return { startHalf: startHalf === "pm" ? "pm" : "full", endHalf: endHalf === "am" ? "am" : "full" }
}

export const isActive = (s: AbsenceStatus) => s === "pending" || s === "approved"

/** Upcoming: active and not yet over (soonest first). Past: everything else in the year (latest first). */
export function splitAbsences<T extends Span & { status: AbsenceStatus; id: number }>(
  items: T[],
  today: string,
  year: number,
) {
  const upcoming = items
    .filter((a) => isActive(a.status) && a.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  const ids = new Set(upcoming.map((a) => a.id))
  const past = items
    .filter((a) => !ids.has(a.id) && (a.startDate.startsWith(`${year}-`) || a.endDate.startsWith(`${year}-`)))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
  return { upcoming, past }
}

/** Short tag for a calendar chip: the first word of the label, at most 10 characters. */
export function shortLabel(label: string): string {
  const word = label.split(/[\s/]+/)[0] ?? label
  return word.length > 10 ? `${word.slice(0, 9)}…` : word
}

export const ATTACHMENT_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/heic"
export const isPreviewableImage = (contentType: string) =>
  ["image/png", "image/jpeg", "image/webp"].includes(contentType)

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Selected state of a ToggleGroup item, clearer than the kit's muted tint. */
export const ON = "aria-pressed:bg-brand-soft aria-pressed:text-primary"

export const upcomingParams = (userId: number, today: string) => ({
  userId,
  from: today,
  to: addDaysStr(today, 730),
  status: ["pending", "approved"] as ("pending" | "approved")[],
})

export const yearParams = (userId: number, year: number) => ({ userId, from: `${year}-01-01`, to: `${year}-12-31` })
