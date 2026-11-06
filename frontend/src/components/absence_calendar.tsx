// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { api } from "../lib/api";
import { holidayName, t } from "../lib/i18n";
import { addDays, fmtDate, monthEnd, monthStart, weekStart } from "../lib/time";
import { Icon } from "./icons";
import { useAsync } from "./ui";

interface CalDay {
  date: string; is_workday: boolean; holiday: { name: string; fraction: number } | null;
  absences: { label: string; color: string; status: string; halves: string[] }[];
}

/**
 * Clicking `day` with `anchor` = the first day chosen in this picking sequence (null when none):
 * no anchor or an earlier day starts a new range (and becomes the anchor); a later day ends the range.
 * Returns the new range and the new anchor.
 */
export function nextRange(anchor: string | null, day: string): { start: string; end: string; anchor: string | null } {
  if (anchor && day >= anchor) return { start: anchor, end: day, anchor: null };
  return { start: day, end: day, anchor: day };
}

/**
 * Month calendar for picking an absence period. Marks public holidays, days off, the person's existing
 * absences (approved, or requested and pending), today and the selected days – with a legend.
 */
export function AbsenceCalendar({ userId, start, end, today, onChange }: {
  userId?: number; start: string; end: string; today: string; onChange: (start: string, end: string) => void;
}) {
  const [month, setMonth] = useState(monthStart(start || today));
  const [anchor, setAnchor] = useState<string | null>(null);
  const from = weekStart(month);
  const to = addDays(from, 41);
  const days = useAsync(() => api.get<{ days: CalDay[] }>("/days", { from, to, user_id: userId }), [from, to, userId]);
  const byDate = new Map((days.data?.days || []).map((d) => [d.date, d]));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  const lastOfMonth = monthEnd(month);
  return (
    <div class="abs-cal" aria-label={t("absences.calendar")}>
      <div class="head">
        <strong>{fmtDate(month, { month: "long", year: "numeric" })}</strong>
        <span class="row" style="gap:4px">
          <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.previous")} onClick={() => setMonth(monthStart(addDays(month, -1)))}><Icon.chevronLeft /></button>
          <button type="button" class="btn btn-ghost btn-sm" onClick={() => setMonth(monthStart(today))}>{t("common.today")}</button>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.next")} onClick={() => setMonth(monthStart(addDays(lastOfMonth, 1)))}><Icon.chevronRight /></button>
        </span>
      </div>
      <div class="grid">
        {cells.slice(0, 7).map((d) => <div key={d} class="wd">{fmtDate(d, { weekday: "narrow" })}</div>)}
        {cells.map((date) => {
          const d = byDate.get(date);
          const inMonth = date >= month && date <= lastOfMonth;
          const selected = !!start && date >= start && date <= end;
          const titles: string[] = [];
          if (d?.holiday) titles.push(holidayName(d.holiday.name) + (d.holiday.fraction < 1 ? " (½)" : ""));
          for (const a of d?.absences || []) if (a.status === "approved" || a.status === "pending") titles.push(`${a.label}${a.status === "pending" ? ` (${t("absences.status.pending")})` : ""}`);
          const cls = ["d", inMonth ? "" : "other", d && !d.is_workday && !d.holiday ? "we" : "", d?.holiday ? "hol" : "", date === today ? "today" : "", selected ? "sel" : ""].join(" ");
          return (
            <button type="button" key={date} class={cls} title={titles.join(" · ") || undefined} aria-pressed={selected}
              onClick={() => { const r = nextRange(anchor, date); setAnchor(r.anchor); onChange(r.start, r.end); }}>
              {Number(date.slice(8, 10))}
              {(d?.absences || []).filter((a) => a.status === "approved" || a.status === "pending").slice(0, 1).map((a, i) => {
                const half = a.halves.length === 1 ? a.halves[0] : "";
                return <span key={i} class={`mark ${half} ${a.status === "pending" ? "pending" : ""}`} style={{ background: a.color }} />;
              })}
            </button>
          );
        })}
      </div>
      <div class="tiny muted" style="margin-top:6px">{anchor ? t("absences.calendar_hint_end") : t("absences.calendar_hint")}</div>
      <div class="legend" style="margin-top:8px">
        <span><span class="dot" style="background: color-mix(in srgb, var(--color-brand) 35%, var(--color-surface-2))" />{t("absences.legend_selected")}</span>
        <span><span class="dot" style="background: color-mix(in srgb, var(--color-holiday) 55%, transparent)" />{t("team.legend_holiday")}</span>
        <span><span class="dot" style="background: var(--color-brand)" />{t("absences.legend_approved")}</span>
        <span><span class="dot" style="background: var(--color-surface-3); background-image: repeating-linear-gradient(45deg, rgba(255,255,255,.5) 0 2px, transparent 2px 4px)" />{t("team.legend_pending")}</span>
        <span><span class="dot" style="background: transparent; border: 1px solid var(--color-border)" />{t("team.legend_free")}</span>
        <span><span class="dot" style="background: transparent; box-shadow: inset 0 0 0 2px var(--color-brand)" />{t("common.today")}</span>
      </div>
    </div>
  );
}
