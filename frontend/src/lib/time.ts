// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
/** Date/time helpers. The API stores UTC; everything is displayed in the user's timezone. */
import { intlLocale } from "./i18n";

export function fmtDuration(min: number | null | undefined, opts: { signed?: boolean; zero?: string } = {}): string {
  if (min === null || min === undefined || Number.isNaN(min)) return "–";
  const rounded = Math.round(min);
  if (rounded === 0 && opts.zero !== undefined) return opts.zero;
  const neg = rounded < 0;
  const abs = Math.abs(rounded);
  const s = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
  if (opts.signed) return (neg ? "−" : rounded > 0 ? "+" : "±") + s;
  return neg ? "−" + s : s;
}

export function fmtHours(min: number): string {
  return (min / 60).toLocaleString(intlLocale(), { maximumFractionDigits: 1 });
}

export function fmtDays(d: number | null | undefined): string {
  if (d === null || d === undefined) return "–";
  return d.toLocaleString(intlLocale(), { maximumFractionDigits: 2 });
}

function parts(iso: string, tz: string) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return p;
}

/** "HH:MM" in the given timezone. */
export function fmtTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "…";
  const p = parts(iso, tz);
  return `${p.hour}:${p.minute}`;
}

/** Local date "YYYY-MM-DD" of an ISO timestamp in a timezone. */
export function localDate(iso: string, tz: string): string {
  const p = parts(iso, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Minutes since local midnight of an ISO timestamp. */
export function minutesOfDay(iso: string, tz: string): number {
  const p = parts(iso, tz);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** Naive local "YYYY-MM-DDTHH:MM" (for API payloads, interpreted in the user's timezone). */
export function toLocalInput(iso: string, tz: string): string {
  const p = parts(iso, tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function todayIn(tz: string): string {
  return localDate(new Date().toISOString(), tz);
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function weekStart(s: string): string {
  const d = parseDate(s);
  const wd = (d.getUTCDay() + 6) % 7;
  return addDays(s, -wd);
}

export function monthStart(s: string): string {
  return s.slice(0, 8) + "01";
}

export function monthEnd(s: string): string {
  const d = parseDate(monthStart(s));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return isoDate(d);
}

export function addMonths(s: string, n: number): string {
  const d = parseDate(monthStart(s));
  d.setUTCMonth(d.getUTCMonth() + n);
  return isoDate(d);
}

export function weekday(s: string): number {
  return (parseDate(s).getUTCDay() + 6) % 7; // 0 = Monday
}

export function fmtDate(s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!s) return "–";
  return new Intl.DateTimeFormat(intlLocale(), { ...opts, timeZone: "UTC" }).format(parseDate(s.slice(0, 10)));
}

export function fmtDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "–";
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function weekdayName(i: number, style: "short" | "long" | "narrow" = "short"): string {
  const base = new Date(Date.UTC(2024, 0, 1 + i)); // 1 Jan 2024 is a Monday
  return new Intl.DateTimeFormat(intlLocale(), { weekday: style, timeZone: "UTC" }).format(base);
}

export function monthName(m: number, style: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat(intlLocale(), { month: style, timeZone: "UTC" }).format(new Date(Date.UTC(2024, m - 1, 1)));
}

export function relativeTime(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Zurich";
  } catch {
    return "Europe/Zurich";
  }
}
