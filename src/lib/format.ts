/**
 * Client-safe formatting of durations, dates and times. All durations are minutes (numbers).
 * Use with tabular numerals (`tabular` utility) wherever numbers line up in columns.
 */

/** 125 → "2:05"; negative values get a real minus sign; `sign` forces "+" for positives. */
export function fmtMinutes(min: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (min == null || Number.isNaN(min)) return "–"
  const total = Math.round(min)
  const neg = total < 0
  const abs = Math.abs(total)
  const s = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`
  if (neg) return `−${s}`
  return opts.sign && total > 0 ? `+${s}` : s
}

/** Decimal hours, e.g. 90 → "1.50" (reports). */
export function fmtHours(min: number, digits = 2): string {
  return (min / 60).toFixed(digits)
}

/** Vacation days with up to one decimal (half days): 2.5, 3. */
export function fmtDays(days: number | null | undefined): string {
  if (days == null) return "–"
  const r = Math.round(days * 100) / 100
  return Number.isInteger(r) ? String(r) : r.toFixed(r * 10 === Math.round(r * 10) ? 1 : 2)
}

export function parseDay(d: string): Date {
  const [y, m, dd] = d.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, dd, 12))
}

// formatters are costly to build and tables format hundreds of values; a view uses only a few option sets
const dateFormats = new Map<string, Intl.DateTimeFormat>()

/** A cached Intl.DateTimeFormat for the locale and options. */
export function dateFormat(intl: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${intl}|${JSON.stringify(options)}`
  let format = dateFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(intl, options)
    dateFormats.set(key, format)
  }
  return format
}

export function fmtDay(
  d: string,
  intl: string,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  return dateFormat(intl, { ...opts, timeZone: "UTC" }).format(parseDay(d))
}

/**
 * A range of days with what both ends share written once: "2.–8. Nov. 2026", "Mo., 18. – Mi., 20. Jan. 2027".
 * ICU's thin spaces become plain ones and Italian's zero-padded days ("02–08 nov") lose the zero.
 */
export function fmtDayRange(
  from: string,
  to: string,
  intl: string,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  if (from === to) return fmtDay(from, intl, opts)
  return dateFormat(intl, { ...opts, timeZone: "UTC" })
    .formatRange(parseDay(from), parseDay(to))
    .replace(/\u2009/gu, " ")
    .replace(/\b0(\d)/gu, "$1")
}

export function fmtDayLong(d: string, intl: string): string {
  return fmtDay(d, intl, { weekday: "long", day: "numeric", month: "long" })
}

export function fmtWeekdayShort(d: string, intl: string): string {
  return fmtDay(d, intl, { weekday: "short" })
}

export function fmtMonth(month: string, intl: string): string {
  return fmtDay(`${month}-01`, intl, { month: "long", year: "numeric" })
}

/** Time of an instant in a timezone, honouring the person's 24h/12h preference. */
export function fmtTime(at: string | null | undefined, opts: { intl: string; tz: string; hour12?: boolean }): string {
  if (!at) return "–"
  return dateFormat(opts.intl, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: opts.hour12 ?? false,
    timeZone: opts.tz,
  }).format(new Date(at))
}

export function fmtDateTime(
  at: string | null | undefined,
  opts: { intl: string; tz: string; hour12?: boolean },
): string {
  if (!at) return "–"
  return dateFormat(opts.intl, {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: opts.hour12 ?? false,
    timeZone: opts.tz,
  }).format(new Date(at))
}

/** Day of an instant in a timezone as YYYY-MM-DD. */
export function dayOf(at: string | Date, tz: string): string {
  const d = typeof at === "string" ? new Date(at) : at
  return dateFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

export function addDaysStr(d: string, n: number): string {
  const x = parseDay(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

export function addMonthsStr(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

/** First and last day of a `YYYY-MM` month. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: addDaysStr(`${addMonthsStr(month, 1)}-01`, -1) }
}

/** Monday of the week of `d`. */
export function mondayOf(d: string): string {
  const wd = (parseDay(d).getUTCDay() + 6) % 7
  return addDaysStr(d, -wd)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?"
}

export function relativeTime(at: string, intl: string): string {
  const diff = (new Date(at).getTime() - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(intl, { numeric: "auto" })
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), "second")
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute")
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour")
  return rtf.format(Math.round(diff / 86400), "day")
}
