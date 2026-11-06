// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { me, type Schedule, type User } from "../lib/store";
import { fmtDate, fmtDuration, todayIn } from "../lib/time";
import { DurationInput, ScheduleEditor, type WeekMinutes, WEEKDAY_KEYS, safely, scheduleFromPensum, val, weeklyTotal } from "../views/admin_common";
import { Icon } from "./icons";
import { Confirm, ErrorBox, Field, useAction } from "./ui";

export interface Team { id: number; name: string; color?: string }

/** Team picker. Loads the teams itself unless a list is passed in. */
export function TeamSelect({ value, onChange, teams, emptyLabel, style }: {
  value: number | null; onChange: (v: number | null) => void; teams?: Team[]; emptyLabel?: string; style?: string;
}) {
  const [loaded, setLoaded] = useState<Team[] | null>(null);
  if (!teams && !loaded) api.get<Team[]>("/teams").then(setLoaded).catch(() => setLoaded([]));
  const list = teams || loaded || [];
  return (
    <select class="select" style={style} value={value ?? ""} onChange={(e) => onChange(val(e) ? Number(val(e)) : null)} aria-label={t("common.team")}>
      <option value="">{emptyLabel || t("admin.users.no_team")}</option>
      {list.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
    </select>
  );
}

function firstOfNextMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Work-schedule versions of a person: list, add a version (from a date), delete (admins).
 *  Used by Administration → Employees and by the team member page. */
export function SchedulePanel({ user, canEdit, canDelete, onChanged }: { user: User; canEdit: boolean; canDelete: boolean; onChanged: () => void }) {
  const fulltime = me.value?.fulltime_weekly_minutes || 2520;
  const schedules = [...(user.schedules || [])].sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  const latest = schedules[0];
  const [adding, setAdding] = useState(false);
  const [validFrom, setValidFrom] = useState(firstOfNextMonth(todayIn(user.timezone)));
  const [pensum, setPensum] = useState(latest?.pensum_percent ?? 100);
  const [minutes, setMinutes] = useState<WeekMinutes>((latest?.minutes as WeekMinutes) || scheduleFromPensum(100, fulltime));
  const [reason, setReason] = useState("");
  const [toDelete, setToDelete] = useState<Schedule | null>(null);
  const { busy, run, error, fieldErrors } = useAction();
  async function add(e: Event) {
    e.preventDefault();
    const r = await run(() => api.post(`/users/${user.id}/schedules`, { valid_from: validFrom, pensum_percent: pensum, minutes, reason }), t("common.saved"));
    if (r) { setAdding(false); onChanged(); }
  }
  return (
    <div class="stack lg">
      <p class="muted small">{t("admin.schedule.help")}</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>{t("admin.schedule.valid_from")}</th><th class="n">{t("admin.schedule.pensum")}</th>
            {WEEKDAY_KEYS.map((k, i) => <th key={k} class="n hide-mobile">{t(`admin.schedule.wd.${i}`)}</th>)}
            <th class="n">{t("admin.schedule.week")}</th>{canDelete && <th />}</tr></thead>
          <tbody>
            {schedules.map((s, idx) => (
              <tr key={s.id}>
                <td>{fmtDate(s.valid_from)}{idx === 0 && <span class="badge brand" style="margin-left:8px">{t("admin.schedule.current")}</span>}</td>
                <td class="n">{s.pensum_percent} %</td>
                {WEEKDAY_KEYS.map((k) => <td key={k} class="n hide-mobile">{s.minutes[k] ? fmtDuration(s.minutes[k]) : <span class="faint">–</span>}</td>)}
                <td class="n"><strong>{fmtDuration(s.weekly_minutes)}</strong></td>
                {canDelete && <td class="n">{schedules.length > 1 && <button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.delete")} onClick={() => setToDelete(s)}><Icon.trash /></button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && !adding && (
        <div><button class="btn" onClick={() => setAdding(true)}><Icon.plus />{t("admin.schedule.add")}</button></div>
      )}
      {canEdit && adding && (
        <form class="card flat stack" onSubmit={add} style="background:var(--color-surface-2)">
          <h3>{t("admin.schedule.add")}</h3>
          <ErrorBox error={error} />
          <div class="form-grid">
            <Field label={t("admin.schedule.valid_from")} help={t("admin.schedule.valid_from_help")} error={fieldErrors.valid_from}>
              <input class="input" type="date" required value={validFrom} onInput={(e) => setValidFrom(val(e))} />
            </Field>
            <Field label={`${t("admin.schedule.pensum")} (%)`} error={fieldErrors.pensum_percent}>
              <input class="input num" type="number" min={1} max={100} value={pensum}
                onInput={(e) => { const p = Number(val(e)) || 100; setPensum(p); setMinutes(scheduleFromPensum(p, fulltime)); }} />
            </Field>
          </div>
          <ScheduleEditor minutes={minutes} onChange={setMinutes} />
          <Field label={t("common.reason")} help={t("common.optional")}><input class="input" value={reason} onInput={(e) => setReason(val(e))} /></Field>
          <div class="row end">
            <button type="button" class="btn btn-ghost" onClick={() => setAdding(false)}>{t("common.cancel")}</button>
            <button class="btn btn-primary" disabled={busy || weeklyTotal(minutes) < 0}>{t("common.save")}</button>
          </div>
        </form>
      )}
      {toDelete && (
        <Confirm danger title={t("admin.schedule.delete_title")} message={t("admin.schedule.delete_message", { date: fmtDate(toDelete.valid_from) })}
          confirmLabel={t("common.delete")} onClose={() => setToDelete(null)}
          onConfirm={async () => { if (await safely(() => api.del(`/schedules/${toDelete.id}`), t("common.saved"))) onChanged(); }} />
      )}
    </div>
  );
}

export { DurationInput };
