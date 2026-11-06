// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { TimeInput } from "../components/time_input";
import { WorkLogWeek } from "./worklog";
import { Shell } from "../components/Shell";
import { Duration, Empty, ErrorBox, Field, Loading, Modal, PageHead, Segmented, useAction, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { absenceLabel, holidayName, t } from "../lib/i18n";
import { bumpData, dataVersion, me, type User } from "../lib/store";
import { fmtHourLabel,
  addDays, addMonths, fmtDate, fmtDateTime, fmtDuration, fmtTime, localDate, minutesOfDay, monthEnd, monthStart,
  todayIn, toLocalInput, weekStart, weekdayName,
} from "../lib/time";

export function TimePage() {
  return (
    <Shell active="time" title={t("nav.time")}>
      <SelfTime />
    </Shell>
  );
}

function SelfTime() {
  const u = me.value!.user;
  return (
    <>
      <PageHead title={t("time.title")} sub={t("time.sub")} />
      <TimeView user={u} />
    </>
  );
}

interface Entry {
  id: number; user_id: number; kind: "work" | "break"; start_at: string; end_at: string | null; running: boolean;
  note: string; source: string; minutes: number; edited: boolean; corrected: boolean; deleted?: boolean;
}

export type LockedMonths = Record<string, { id: number; signed_by: string | null; signed_at: string; note: string }>;

export interface Day {
  date: string; weekday: number; scheduled_min: number; holiday: { name: string; fraction: number } | null;
  target_min: number; worked_min: number; break_min: number; delta_min: number; running: boolean;
  is_workday: boolean; is_future: boolean; employed: boolean; vacation_days: number; edited: boolean;
  absences: { id: number; type: string; label: string; color: string; status: string; halves: string[]; category: string }[];
  warnings: string[];
  worklog_min: number; worklog_required_min: number; worklog_ok: boolean;
}

/** Reusable time view: the signed-in user's own time, or a team member's (for leads/admins). */
export function TimeView({ user }: { user: User }) {
  const tz = user.timezone;
  const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const [mode, setMode] = useState<"week" | "month">((params.get("view") as "week" | "month") || "week");
  const [anchor, setAnchor] = useState(params.get("date") || todayIn(tz));
  const [editing, setEditing] = useState<{ entry?: Entry; date?: string; start?: string } | null>(
    params.get("add") ? { date: todayIn(tz) } : null);
  const [history, setHistory] = useState<Entry | null>(null);
  const self = user.id === me.value?.user.id;

  const range = useMemo(() => {
    if (mode === "week") {
      const s = weekStart(anchor);
      return { from: s, to: addDays(s, 6) };
    }
    const s = monthStart(anchor);
    return { from: weekStart(s), to: addDays(weekStart(monthEnd(s)), 6) };
  }, [mode, anchor]);

  const q = { from: range.from, to: range.to, user_id: self ? undefined : user.id };
  const days = useAsync(() => api.get<{ days: Day[]; summary: any; locked_months: LockedMonths }>("/days", q), [range.from, range.to, user.id, dataVersion.value]);
  const locked: LockedMonths = days.data?.locked_months || {};
  const lockedInView = Object.entries(locked);
  const entries = useAsync(() => api.get<Entry[]>("/entries", q), [range.from, range.to, user.id, dataVersion.value]);

  function shift(n: number) {
    setAnchor(mode === "week" ? addDays(anchor, 7 * n) : addMonths(anchor, n));
  }

  const title = mode === "week"
    ? `${fmtDate(range.from, { day: "numeric", month: "short" })} – ${fmtDate(range.to, { day: "numeric", month: "short", year: "numeric" })}`
    : fmtDate(monthStart(anchor), { month: "long", year: "numeric" });
  const summary = days.data?.summary;
  const monthDays = mode === "month" ? days.data?.days.filter((d) => d.date.slice(0, 7) === anchor.slice(0, 7)) : days.data?.days;
  const monthSum = monthDays && {
    worked: monthDays.reduce((a, d) => a + d.worked_min, 0),
    target: monthDays.filter((d) => !d.is_future).reduce((a, d) => a + d.target_min, 0),
    delta: monthDays.reduce((a, d) => a + d.delta_min, 0),
  };

  return (
    <div class="stack lg">
      <ErrorBox error={days.error || entries.error} />
      {lockedInView.map(([month, info]) => (
        <div key={month} class="alert row" style="gap:10px">
          <Icon.lock width={18} />
          <span>{t("time.locked_banner", { month: fmtDate(`${month}-01`, { month: "long", year: "numeric" }), name: info.signed_by || "?", date: fmtDate(info.signed_at?.slice(0, 10)) })}</span>
        </div>
      ))}
      <div class="card">
        <div class="row between wrap" style="margin-bottom:18px">
          <div class="row wrap">
            <Segmented value={mode} onChange={setMode} options={[{ value: "week", label: t("time.week") }, { value: "month", label: t("time.month") }]} />
            <div class="row" style="gap:4px">
              <button class="btn btn-ghost btn-icon btn-sm" onClick={() => shift(-1)} aria-label={t("common.previous")}><Icon.chevronLeft /></button>
              <button class="btn btn-sm" onClick={() => setAnchor(todayIn(tz))}>{t("common.today")}</button>
              <button class="btn btn-ghost btn-icon btn-sm" onClick={() => shift(1)} aria-label={t("common.next_period")}><Icon.chevronRight /></button>
            </div>
            <h2 style="font-size:1.05rem">{title}</h2>
          </div>
          <div class="row wrap">
            {monthSum && (
              <div class="row small" style="gap:16px">
                <span class="muted">{t("time.worked")} <strong class="num" style="color:var(--color-text)">{fmtDuration(monthSum.worked)}</strong></span>
                <span class="muted">{t("time.target")} <strong class="num" style="color:var(--color-text)">{fmtDuration(monthSum.target)}</strong></span>
                <span class="muted">{t("time.delta")} <Duration min={monthSum.delta} signed /></span>
              </div>
            )}
            <button class="btn btn-primary" onClick={() => setEditing({ date: mode === "week" && anchor !== todayIn(tz) ? anchor : todayIn(tz) })}><Icon.plus />{t("time.add_entry")}</button>
          </div>
        </div>
        {(days.loading && !days.data) || (entries.loading && !entries.data) ? <Loading /> : days.data && entries.data ? (
          mode === "week"
            ? <WeekTimeline days={days.data.days} entries={entries.data} tz={tz} locked={locked} onEdit={(e) => setEditing({ entry: e })}
                onAdd={(date, start) => !locked[date.slice(0, 7)] && setEditing({ date, start })} />
            : <MonthGrid days={days.data.days} month={anchor.slice(0, 7)} tz={tz} locked={locked} onPick={(d) => { setAnchor(d); setMode("week"); }} />
        ) : null}
        {summary && mode === "week" && (
          <div class="row wrap small" style="margin-top:16px;gap:18px;justify-content:flex-end">
            <span class="legend">
              <span><span class="dot" style="background:var(--color-work)" />{t("time.legend_work")}</span>
              <span><span class="dot" style="background:var(--color-break)" />{t("time.legend_break")}</span>
              <span>✎ {t("time.legend_edited")}</span>
              <span><span class="dot" style="background:var(--color-break);outline:2px solid var(--color-break)" />{t("time.legend_corrected")}</span>
            </span>
          </div>
        )}
      </div>
      {mode === "week" && days.data && (
        <WorkLogWeek user={user} days={days.data.days} from={range.from} to={range.to}
          editable={self ? true : !!(me.value?.permissions.hr || me.value?.permissions.lead)} />
      )}
      <EntryList entries={entries.data || []} tz={tz} onEdit={(e) => setEditing({ entry: e })} onHistory={setHistory} />
      {editing && <EntryEditor user={user} entry={editing.entry} date={editing.date} start={editing.start} locked={locked}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); bumpData(); }} onHistory={(e) => { setEditing(null); setHistory(e); }} />}
      {history && <HistoryModal entry={history} tz={tz} self={self} onClose={() => setHistory(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ week timeline

function WeekTimeline({ days, entries, tz, locked, onEdit, onAdd }: {
  days: Day[]; entries: Entry[]; tz: string; locked: LockedMonths; onEdit: (e: Entry) => void; onAdd: (date: string, start: string) => void;
}) {
  const today = todayIn(tz);
  const segsByDay: Record<string, { e: Entry; s: number; f: number }[]> = {};
  for (const e of entries) {
    const end = e.end_at || new Date().toISOString();
    let d = localDate(e.start_at, tz);
    const endDate = localDate(end, tz);
    // split across midnight
    while (d <= endDate) {
      const s = d === localDate(e.start_at, tz) ? minutesOfDay(e.start_at, tz) : 0;
      const f = d === endDate ? minutesOfDay(end, tz) : 1440;
      (segsByDay[d] ||= []).push({ e, s, f: Math.max(f, s + 1) });
      d = addDays(d, 1);
    }
  }
  let lo = 6 * 60;
  let hi = 20 * 60;
  for (const list of Object.values(segsByDay)) for (const x of list) { lo = Math.min(lo, Math.floor(x.s / 60) * 60); hi = Math.max(hi, Math.ceil(x.f / 60) * 60); }
  const span = hi - lo;
  const pos = (m: number) => `${((m - lo) / span) * 100}%`;
  const hours: number[] = [];
  for (let h = lo; h <= hi; h += 120) hours.push(h);
  const nowMin = minutesOfDay(new Date().toISOString(), tz);

  function clickTrack(ev: MouseEvent, date: string) {
    if ((ev.target as HTMLElement).closest(".seg")) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const m = lo + ((ev.clientX - rect.left) / rect.width) * span;
    const r = Math.round(m / 15) * 15;
    onAdd(date, `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`);
  }

  return (
    <div class="timeline">
      <div />
      <div class="scale">{hours.map((h) => <span key={h} style={{ left: pos(h) }}>{fmtHourLabel(h / 60)}</span>)}</div>
      <div />
      {days.map((d) => {
        const segs = segsByDay[d.date] || [];
        const approved = d.absences.filter((a) => a.status === "approved");
        const pending = d.absences.filter((a) => a.status === "pending");
        const cls = d.holiday ? "holiday" : approved.length ? "absent" : "";
        return [
          <div key={d.date + "l"} class="day-label" style={d.date === today ? "color:var(--color-brand-bright)" : ""} title={!d.worklog_ok ? t("worklog.day_incomplete", { percent: me.value?.worklog?.percent ?? 0 }) : undefined}>
            {!d.worklog_ok && <span class="worklog-flag" aria-label={t("signoff.blocker.worklog_incomplete")}>!</span>}
            {locked[d.date.slice(0, 7)] && <Icon.lock width={12} style="vertical-align:-1px;margin-right:4px;color:var(--color-pos)" />}
            {weekdayName(d.weekday)} {fmtDate(d.date, { day: "numeric", month: "numeric" })}
            <small>{d.scheduled_min > 0 ? t("time.target_short", { t: fmtDuration(d.target_min) }) : t("time.free")}</small>
          </div>,
          <div key={d.date + "t"} class={`track ${cls}`} style={locked[d.date.slice(0, 7)] ? "cursor:default" : ""}
            onClick={(ev) => clickTrack(ev as unknown as MouseEvent, d.date)} title={locked[d.date.slice(0, 7)] ? t("time.locked_short") : t("time.click_to_add")}>
            {hours.map((h) => <div key={h} class="gridline" style={{ left: pos(h) }} />)}
            {(d.holiday || approved.length > 0 || pending.length > 0) && segs.length === 0 && (
              <div class="overlay-label">
                {d.holiday && <span class="badge swiss">{holidayName(d.holiday.name)}{d.holiday.fraction < 1 ? " ½" : ""}</span>}
                {approved.map((a) => <span key={a.id} class="chip" style={{ background: a.color }}>{absenceLabel(a.type)}{a.halves.length === 1 ? ` (${t(`absences.half.${a.halves[0]}`)})` : ""}</span>)}
                {pending.map((a) => <span key={a.id} class="badge warn">{absenceLabel(a.type)} · {t("absences.status.pending")}</span>)}
              </div>
            )}
            {segs.map(({ e, s, f }) => (
              <div key={e.id + "-" + s} class={`seg ${e.kind} ${e.running ? "running" : ""} ${e.edited || e.source === "manual" ? "edited" : ""} ${e.corrected ? "corrected" : ""}`}
                style={{ left: pos(s), width: `calc(${((f - s) / span) * 100}% - 1px)` }}
                title={`${t(`time.kind.${e.kind}`)} ${fmtTime(e.start_at, tz)}–${e.end_at ? fmtTime(e.end_at, tz) : t("time.running")}${e.note ? " · " + e.note : ""}`}
                onClick={() => onEdit(e)}>
                {f - s > 80 ? `${fmtTime(e.start_at, tz)}–${e.end_at ? fmtTime(e.end_at, tz) : "…"}` : ""}
              </div>
            ))}
            {d.date === today && nowMin >= lo && nowMin <= hi && <div class="now-line" style={{ left: pos(nowMin) }} />}
          </div>,
          <div key={d.date + "s"} class="totals">
            <strong>{d.worked_min ? fmtDuration(d.worked_min) : "–"}</strong>
            {!d.is_future && (d.target_min > 0 || d.worked_min > 0) && <small><Duration min={d.delta_min} signed /></small>}
            {d.warnings.includes("break_too_short") && <small class="neg" title={t("time.break_warning_help")}>{t("time.break_warning")}</small>}
          </div>,
        ];
      })}
    </div>
  );
}

// ------------------------------------------------------------------ month grid

function MonthGrid({ days, month, tz, locked, onPick }: { days: Day[]; month: string; tz: string; locked: LockedMonths; onPick: (d: string) => void }) {
  const today = todayIn(tz);
  return (
    <div class="month">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} class="wd">{weekdayName(i)}</div>)}
      {days.map((d) => {
        const other = d.date.slice(0, 7) !== month;
        const weekend = !d.is_workday && !d.holiday;
        return (
          <div key={d.date} role="button" tabIndex={0} aria-label={fmtDate(d.date, { weekday: "long", day: "numeric", month: "long" })} class={`cell ${other ? "other" : ""} ${weekend ? "weekend" : ""} ${d.date === today ? "today" : ""}`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} onClick={() => onPick(d.date)}>
            <div class="d"><span>{Number(d.date.slice(8))}{!d.worklog_ok && <span class="worklog-flag" title={t("signoff.blocker.worklog_incomplete")}>!</span>}</span>
              <span class="row" style="gap:3px">{d.edited && <span class="tiny faint" title={t("time.legend_edited")}>✎</span>}
                {locked[d.date.slice(0, 7)] && <Icon.lock width={11} style="color:var(--color-pos)" />}</span></div>
            {d.worked_min > 0 && <div class="w">{fmtDuration(d.worked_min)}</div>}
            {!d.is_future && d.target_min + d.worked_min > 0 && <div class="delta"><Duration min={d.delta_min} signed /></div>}
            {d.holiday && <div class="tag hol">{holidayName(d.holiday.name)}</div>}
            {d.absences.map((a) => <div key={a.id} class="tag" style={{ background: a.color, opacity: a.status === "pending" ? 0.55 : 1 }}>{absenceLabel(a.type)}</div>)}
            {d.running && <span class="pulse state-working" />}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ list

function EntryList({ entries, tz, onEdit, onHistory }: { entries: Entry[]; tz: string; onEdit: (e: Entry) => void; onHistory: (e: Entry) => void }) {
  const sorted = [...entries].sort((a, b) => b.start_at.localeCompare(a.start_at));
  return (
    <div class="card pad-0">
      <div class="card-head" style="padding:18px 20px 0"><h2>{t("time.entries")}</h2><span class="small muted">{t("time.entries_hint")}</span></div>
      {sorted.length === 0 ? <Empty icon={<Icon.clock />} title={t("time.no_entries")} /> : (
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>{t("common.date")}</th><th>{t("common.type")}</th><th>{t("time.from_to")}</th><th class="n">{t("time.duration")}</th><th>{t("common.note")}</th><th /></tr></thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} class="clickable" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} onClick={() => onEdit(e)}>
                  <td class="nowrap">{fmtDate(localDate(e.start_at, tz), { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td><span class="row" style="gap:6px"><span class="dot" style={{ background: e.kind === "work" ? "var(--color-work)" : "var(--color-break)" }} />{t(`time.kind.${e.kind}`)}</span></td>
                  <td class="num nowrap">{fmtTime(e.start_at, tz)} – {e.end_at ? fmtTime(e.end_at, tz) : <span class="badge brand">{t("time.running")}</span>}</td>
                  <td class="n">{fmtDuration(e.minutes)}</td>
                  <td class="muted small" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{e.note}</td>
                  <td class="n">
                    {e.corrected && <span class="badge warn" style="margin-right:6px">{t("time.corrected")}</span>}
                    {!e.corrected && (e.edited || e.source === "manual") && <span class="badge" style="margin-right:6px">{e.source === "manual" && !e.edited ? t("time.manual") : t("time.edited")}</span>}
                    <button class="btn btn-ghost btn-icon btn-sm" aria-label={t("time.history")} onClick={(ev) => { ev.stopPropagation(); onHistory(e); }}><Icon.history /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ editor

export function EntryEditor({ user, entry, date, start, locked = {}, onClose, onSaved, onHistory }: {
  user: User; entry?: Entry; date?: string; start?: string; locked?: LockedMonths; onClose: () => void; onSaved: () => void;
  onHistory: (e: Entry) => void;
}) {
  const tz = user.timezone;
  const self = user.id === me.value?.user.id;
  const initStart = entry ? toLocalInput(entry.start_at, tz) : `${date}T${start || "08:00"}`;
  const initEnd = entry?.end_at ? toLocalInput(entry.end_at, tz) : entry ? "" : `${date}T${addMinutes(start || "08:00", start ? 60 : 240)}`;
  const [kind, setKind] = useState<"work" | "break">(entry?.kind || "work");
  const [day, setDay] = useState(initStart.slice(0, 10));
  const [from, setFrom] = useState(initStart.slice(11, 16));
  const [to, setTo] = useState(initEnd ? initEnd.slice(11, 16) : "");
  const [note, setNote] = useState(entry?.note || "");
  const [reason, setReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, run, fieldErrors } = useAction();
  const [reasonMissing, setReasonMissing] = useState(false);
  const reasonRef = useRef<HTMLInputElement>(null);
  const reasonRequired = !self || day < todayIn(tz);
  const lockInfo = locked[(entry ? initStart : day).slice(0, 7)] || locked[day.slice(0, 7)];
  const readOnly = !!lockInfo;
  const running = entry?.running;
  // end on the next day when the end time is before the start time (night shifts)
  const endDay = to && to < from ? addDays(day, 1) : day;

  async function save(e: Event) {
    e.preventDefault();
    if (readOnly) return;
    if (reasonRequired && !reason.trim()) {
      setReasonMissing(true);
      reasonRef.current?.focus();
      return;
    }
    const body: Record<string, unknown> = { kind, note, reason };
    // Only send times that were changed: keeps the seconds of clock-recorded entries intact.
    const startChanged = !entry || `${day}T${from}` !== initStart;
    const endChanged = !entry || `${endDay}T${to}` !== initEnd;
    if (startChanged) body.start_at = `${day}T${from}:00`;
    if ((!running || to) && (endChanged || startChanged)) body.end_at = `${endDay}T${to}:00`;
    const ok = await run(async () => {
      if (entry) await api.patch(`/entries/${entry.id}`, body);
      else await api.post("/entries", { ...body, user_id: self ? undefined : user.id });
    }, t("common.saved"));
    if (ok !== undefined) onSaved();
  }
  async function remove() {
    if (reasonRequired && !reason.trim()) {
      setReasonMissing(true);
      reasonRef.current?.focus();
      return;
    }
    const ok = await run(() => api.del(`/entries/${entry!.id}`, { reason }), t("time.deleted"));
    if (ok !== undefined) onSaved();
  }
  return (
    <Modal title={entry ? t("time.edit_entry") : t("time.add_entry")} onClose={onClose} footer={
      <>
        {entry && <button type="button" class="btn btn-ghost" style="margin-right:auto" onClick={() => onHistory(entry)}><Icon.history />{t("time.history")}</button>}
        {entry && !readOnly && !confirmDelete && <button type="button" class="btn btn-danger" onClick={() => setConfirmDelete(true)}><Icon.trash />{t("common.delete")}</button>}
        {confirmDelete && <button type="button" class="btn btn-danger" disabled={busy} onClick={remove}>{t("time.confirm_delete")}</button>}
        <button type="button" class="btn btn-ghost" onClick={onClose}>{readOnly ? t("common.close") : t("common.cancel")}</button>
        {!readOnly && <button type="submit" form="entry-form" class="btn btn-primary" disabled={busy}>{t("common.save")}</button>}
      </>
    }>
      <form id="entry-form" class="stack lg" onSubmit={save}>
        {readOnly && (
          <div class="alert row" style="gap:10px;align-items:flex-start">
            <Icon.lock width={18} style="flex:none;margin-top:2px" />
            <span>{t("time.locked_editor", { name: lockInfo.signed_by || "?", date: fmtDate(lockInfo.signed_at?.slice(0, 10)) })}</span>
          </div>
        )}
        {!readOnly && reasonRequired && (
          <div class={`alert ${reasonMissing ? "error" : "warn"} row`} style="gap:10px;align-items:flex-start">
            <Icon.info width={18} style="flex:none;margin-top:2px" />
            <span><strong>{t("time.reason_needed_title")}</strong> {self ? t("time.reason_needed_self") : t("time.reason_needed_other", { name: user.name })}</span>
          </div>
        )}
        {entry?.corrected && self && <div class="alert warn small">{t("time.was_corrected")}</div>}
        <Segmented value={kind} onChange={setKind} options={[{ value: "work", label: t("time.kind.work") }, { value: "break", label: t("time.kind.break") }]} />
        <div class="form-grid" style="grid-template-columns: 1.3fr 1fr 1fr">
          <Field label={t("common.date")} error={fieldErrors.start_at}>
            <input type="date" class="input" required disabled={readOnly} value={day} max={todayIn(tz)} onInput={(e) => setDay((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label={t("time.start")}>
            <TimeInput value={from} onChange={setFrom} required disabled={readOnly} ariaLabel={t("time.start")} />
          </Field>
          <Field label={t("time.end")} error={fieldErrors.end_at} help={to && to < from ? t("time.next_day") : undefined}>
            <TimeInput value={to} onChange={setTo} required={!running} disabled={readOnly} ariaLabel={t("time.end")} />
          </Field>
        </div>
        <Field label={t("common.note")}>
          <input class="input" maxLength={500} disabled={readOnly} value={note} placeholder={t("time.note_placeholder")} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
        </Field>
        {!readOnly && (
          <Field label={<span class="row" style="gap:8px">{t("common.reason")}{reasonRequired
            ? <span class="badge danger">{t("common.required")}</span> : <span class="faint">({t("common.optional")})</span>}</span>}
            help={reasonRequired ? (self ? t("time.reason_past_help") : t("time.reason_other_help")) : t("time.reason_today_help")}
            error={reasonMissing && !reason.trim() ? t("time.reason_missing") : fieldErrors.reason}>
            <input ref={reasonRef} class="input" maxLength={500} aria-required={reasonRequired} aria-invalid={reasonMissing && !reason.trim() ? "true" : undefined}
              value={reason} placeholder={t("time.reason_placeholder")} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
          </Field>
        )}
        <div class="tiny faint">{t("time.tz_hint", { tz })}</div>
      </form>
    </Modal>
  );
}

function addMinutes(hm: string, n: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + n);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ history

const FIELD_ORDER = ["kind", "start_at", "end_at", "note", "is_deleted"];

export function HistoryModal({ entry, tz, self, onClose }: { entry: Entry; tz: string; self: boolean; onClose: () => void }) {
  const { data, loading } = useAsync(() => api.get<any[]>(`/entries/${entry.id}/history`), [entry.id]);
  const [dispute, setDispute] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const { busy, run } = useAction();
  const ownerId = entry.user_id;
  const fmt = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return "–";
    if (k === "start_at" || k === "end_at") return fmtDateTime(String(v), tz);
    if (k === "kind") return t(`time.kind.${v}`);
    if (k === "is_deleted") return v ? t("common.yes") : t("common.no");
    return String(v);
  };
  const corrected = (data || []).some((r) => r.actor && r.actor.id !== ownerId);
  return (
    <Modal title={t("time.history_title")} onClose={onClose} wide footer={self && corrected ? (
      showDispute ? <>
        <input class="input grow" placeholder={t("time.dispute_placeholder")} value={dispute} onInput={(e) => setDispute((e.target as HTMLInputElement).value)} />
        <button class="btn btn-primary" disabled={busy || !dispute.trim()} onClick={async () => {
          if (await run(() => api.post(`/entries/${entry.id}/dispute`, { message: dispute }), t("time.dispute_sent")) !== undefined) onClose();
        }}>{t("time.send_dispute")}</button>
      </> : <button class="btn" onClick={() => setShowDispute(true)}><Icon.alert />{t("time.dispute")}</button>
    ) : undefined}>
      <p class="muted small" style="margin-bottom:16px">{t("time.history_sub")}</p>
      {loading ? <Loading /> : (
        <ul class="history">
          {(data || []).map((r) => {
            const other = r.actor && r.actor.id !== ownerId;
            const changed = r.action === "create" ? [] : FIELD_ORDER.filter((k) => r.changed.includes(k));
            return (
              <li key={r.id}>
                <span class={`pin ${other ? "other" : ""} ${r.action === "delete" ? "del" : ""}`} />
                <div class="row wrap" style="gap:8px">
                  <strong>{t(`time.action.${r.action}`)}</strong>
                  <span class="muted small">{r.actor ? r.actor.name : t("common.unknown")} · {fmtDateTime(r.at, tz)} · {t(`time.source.${r.source}`)}</span>
                  {other && <span class="badge warn">{t("time.by_other")}</span>}
                </div>
                {r.action === "create" && r.after && (
                  <div class="small" style="margin-top:4px">{t(`time.kind.${r.after.kind}`)} {fmt("start_at", r.after.start_at)} → {fmt("end_at", r.after.end_at)}</div>
                )}
                {changed.map((k) => (
                  <div key={k} class="small diff" style="margin-top:4px">
                    <span class="muted">{t(`time.field.${k}`)}:</span><del>{fmt(k, r.before?.[k])}</del><span>→</span><ins>{fmt(k, r.after?.[k])}</ins>
                  </div>
                ))}
                {r.reason && r.reason !== "clock" && <div class="small" style="margin-top:4px">“{r.reason}”</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

