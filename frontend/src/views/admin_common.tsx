// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
/** Shared helpers for the admin pages. */
import { useEffect, useState } from "preact/hooks";
import { tError } from "../lib/i18n";
import { t } from "../lib/i18n";
import { toast } from "../lib/store";
import { fmtDuration, weekdayName } from "../lib/time";

export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekMinutes = Record<(typeof WEEKDAY_KEYS)[number], number>;

/** Parse "8:24", "8.4", "8,4" or "8" into minutes. Returns null if invalid. */
export function parseDuration(s: string): number | null {
  const v = s.trim().replace(",", ".");
  if (v === "") return 0;
  const neg = v.startsWith("-") || v.startsWith("−");
  const body = neg ? v.slice(1) : v;
  let min: number;
  if (body.includes(":")) {
    const [h, m] = body.split(":");
    if (!/^\d+$/.test(h || "0") || !/^\d{1,2}$/.test(m || "0")) return null;
    min = Number(h || 0) * 60 + Number(m || 0);
  } else {
    const n = Number(body);
    if (Number.isNaN(n)) return null;
    min = Math.round(n * 60);
  }
  return neg ? -min : min;
}

/** Text input for durations (H:MM). Calls onChange with minutes when valid. */
export function DurationInput({ value, onChange, allowNegative, id, ariaLabel }: {
  value: number; onChange: (min: number) => void; allowNegative?: boolean; id?: string; ariaLabel?: string;
}) {
  const [text, setText] = useState(fmtDuration(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (parseDuration(text) !== value) setText(fmtDuration(value).replace("−", "-"));
  }, [value]);
  return (
    <input id={id} aria-label={ariaLabel} class="input num" inputMode="decimal" value={text} aria-invalid={bad ? "true" : undefined}
      placeholder="0:00" style="text-align:right"
      onInput={(e) => {
        const s = (e.target as HTMLInputElement).value;
        setText(s);
        const m = parseDuration(s);
        const ok = m !== null && (allowNegative || m >= 0);
        setBad(!ok);
        if (ok) onChange(m!);
      }}
      onBlur={() => !bad && setText(fmtDuration(value).replace("−", "-"))} />
  );
}

export function scheduleFromPensum(pensum: number, fulltimeWeekly: number): WeekMinutes {
  const daily = Math.round(((fulltimeWeekly / 5) * pensum) / 100);
  return { mon: daily, tue: daily, wed: daily, thu: daily, fri: daily, sat: 0, sun: 0 };
}

export function weeklyTotal(m: Partial<WeekMinutes>): number {
  return WEEKDAY_KEYS.reduce((s, k) => s + (m[k] || 0), 0);
}

/** Seven duration inputs (Mon–Sun) with weekly total. */
export function ScheduleEditor({ minutes, onChange }: { minutes: WeekMinutes; onChange: (m: WeekMinutes) => void }) {
  return (
    <div class="stack sm">
      <div class="admin-week">
        {WEEKDAY_KEYS.map((k, i) => (
          <div key={k} class="field">
            <label class="tiny">{weekdayName(i)}</label>
            <DurationInput value={minutes[k] || 0} ariaLabel={weekdayName(i, "long")} onChange={(v) => onChange({ ...minutes, [k]: v })} />
          </div>
        ))}
      </div>
      <div class="small muted">{t("admin.schedule.weekly_total", { total: fmtDuration(weeklyTotal(minutes)) })}</div>
    </div>
  );
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Run an API call inside a Confirm dialog: toast errors, rethrow nothing. */
export async function safely(fn: () => Promise<unknown>, okMessage?: string): Promise<boolean> {
  try {
    await fn();
    if (okMessage) toast(okMessage, "ok");
    return true;
  } catch (e) {
    toast(tError(e), "error", 6000);
    return false;
  }
}

export function val(e: Event): string {
  return (e.target as HTMLInputElement).value;
}

export function checked(e: Event): boolean {
  return (e.target as HTMLInputElement).checked;
}
