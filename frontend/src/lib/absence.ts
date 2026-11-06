// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
/** Shared formatting for absences (half-day labels, date ranges). */
import { t } from "./i18n";
import { fmtDate } from "./time";

export interface AbsenceSpan { start_date: string; end_date: string; start_half: string; end_half: string }

export function halfLabel(h: string): string {
  return h === "am" ? t("absences.half.am") : h === "pm" ? t("absences.half.pm") : "";
}

/** "Mon 7 Dec 2026 (Morning)" or "Mon 7 Dec 2026 (Afternoon) – Fri 11 Dec 2026 (Morning)". */
export function absenceRange(a: AbsenceSpan): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" };
  if (a.start_date === a.end_date) {
    const h = halfLabel(a.start_half);
    return fmtDate(a.start_date, opts) + (h ? ` (${h})` : "");
  }
  const sh = a.start_half === "pm" ? ` (${halfLabel("pm")})` : "";
  const eh = a.end_half === "am" ? ` (${halfLabel("am")})` : "";
  return `${fmtDate(a.start_date, opts)}${sh} – ${fmtDate(a.end_date, opts)}${eh}`;
}

/** Short suffix for list rows: " · Morning" or " · First day: afternoon only, Last day: morning only". */
export function halfSuffix(a: AbsenceSpan): string {
  if (a.start_date === a.end_date) return a.start_half === "full" ? "" : ` · ${t(`absences.half.${a.start_half}`)}`;
  const parts = [];
  if (a.start_half === "pm") parts.push(t("absences.half.start_pm"));
  if (a.end_half === "am") parts.push(t("absences.half.end_am"));
  return parts.length ? ` · ${parts.join(", ")}` : "";
}
