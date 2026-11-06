// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
/** Human-readable labels and values for change-history / audit-log diffs (raw column names otherwise). */
import { t } from "./i18n";
import { fmtDate, fmtDateTime, fmtDuration } from "./time";

const WEEKDAY_MINUTES = /^minutes_(mon|tue|wed|thu|fri|sat|sun)$/;
const WD_INDEX: Record<string, string> = { mon: "0", tue: "1", wed: "2", thu: "3", fri: "4", sat: "5", sun: "6" };

/** Label for a changed field. Entity-specific keys win over the generic audit field list. */
export function fieldLabel(entity: string, key: string): string {
  const wd = key.match(WEEKDAY_MINUTES);
  if (wd) return `${t("admin.audit.fields.minutes")} ${t(`admin.schedule.wd.${WD_INDEX[wd[1]]}`)}`;
  const specific = entity === "time_entry" ? `time.field.${key}` : entity === "absence" ? `absences.field.${key}` : "";
  const generic = `admin.audit.fields.${key}`;
  for (const k of [specific, generic]) {
    if (k && t(k) !== k) return t(k);
  }
  return key.replace(/_/g, " ");
}

/** Format a before/after value according to the field it belongs to. */
export function fmtFieldValue(key: string, v: unknown, tz: string): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return v ? t("common.yes") : t("common.no");
  if (WEEKDAY_MINUTES.test(key) || key === "amount" || key === "weekly_minutes") return typeof v === "number" ? fmtDuration(v) : String(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v, tz);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  if (key === "kind" && typeof v === "string" && t(`time.kind.${v}`) !== `time.kind.${v}`) return t(`time.kind.${v}`);
  if (key === "status" && typeof v === "string" && t(`absences.status.${v}`) !== `absences.status.${v}`) return t(`absences.status.${v}`);
  if ((key === "start_half" || key === "end_half") && typeof v === "string") return t(`absences.half.${v}`);
  if (key === "role" && typeof v === "string") return t(`admin.users.role_${v}`);
  if (key === "pensum_percent") return `${v} %`;
  return String(v);
}
