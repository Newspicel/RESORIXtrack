// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useEffect, useMemo, useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { TimeInput } from "../components/time_input";
import { SearchPicker } from "../components/picker";
import { Segmented, Confirm, ErrorBox, Field, Loading, useAction, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { bumpData, dataVersion, me, type User } from "../lib/store";
import { fmtDate, fmtDuration, fmtTimeOfDay, todayIn, weekdayName } from "../lib/time";
import { DurationInput, val } from "./admin_common";
import type { Day } from "./time";

export interface Project { id: number; name: string; code: string; color: string; team_id: number | null; team_name: string | null; is_active: boolean }
export interface WorkItem { id: number; user_id: number; date: string; minutes: number; start_time: string | null; end_time: string | null; customer_ref: string; note: string; project: Project | null; project_id: number | null }

export function worklogConfig() {
  return me.value?.worklog || { mode: "off", percent: 80, project_required: false };
}

/** Coverage of one day: annotated vs. worked minutes, and whether the company requirement is met. */
export function CoverageBadge({ day }: { day: Pick<Day, "worked_min" | "worklog_min" | "worklog_required_min" | "worklog_ok"> }) {
  if (day.worked_min <= 0) return null;
  const pct = Math.min(100, Math.round((day.worklog_min / day.worked_min) * 100));
  const required = day.worklog_required_min > 0;
  const cls = !day.worklog_ok ? "warn" : day.worklog_min >= day.worked_min - 1 ? "ok" : required ? "ok" : "";
  return <span class={`badge ${cls}`} title={t("worklog.coverage_title", { done: fmtDuration(day.worklog_min), worked: fmtDuration(day.worked_min) })}>{pct} %</span>;
}

/** Week strip with per-day coverage, plus the selected day's items (used in My time and the member page). */
export function WorkLogWeek({ user, days, from, to, editable }: { user: User; days: Day[]; from: string; to: string; editable: boolean }) {
  const cfg = worklogConfig();
  const self = user.id === me.value?.user.id;
  const today = todayIn(user.timezone);
  const [selected, setSelected] = useState<string>(() => {
    const inRange = days.find((d) => d.date === today) ? today : null;
    return inRange || days.find((d) => d.worked_min > 0)?.date || days[0]?.date || today;
  });
  useEffect(() => {
    if (!days.find((d) => d.date === selected)) setSelected(days.find((d) => d.date === today)?.date || days.find((d) => d.worked_min > 0)?.date || days[0]?.date || today);
  }, [from]);
  const items = useAsync(() => api.get<{ items: WorkItem[] }>("/worklog", { from, to, user_id: self ? undefined : user.id }), [from, to, user.id, dataVersion.value]);
  if (cfg.mode === "off") return null;
  const day = days.find((d) => d.date === selected);
  const dayItems = (items.data?.items || []).filter((w) => w.date === selected);
  return (
    <div class="card">
      <div class="card-head">
        <div><h2><Icon.file width={18} />{t("worklog.title")}</h2><p class="card-sub">{cfg.mode === "required" ? t("worklog.sub_required", { percent: cfg.percent }) : t("worklog.sub_optional")}</p></div>
      </div>
      <div class="worklog-strip">
        {days.map((d) => (
          <button key={d.date} type="button" class={`day ${d.date === selected ? "active" : ""} ${d.date === today ? "today" : ""} ${d.is_future ? "future" : ""}`}
            disabled={d.is_future} onClick={() => setSelected(d.date)} aria-pressed={d.date === selected}>
            <span class="wd">{weekdayName(d.weekday)} {fmtDate(d.date, { day: "numeric" })}</span>
            <span class="num small">{d.worked_min > 0 ? fmtDuration(d.worked_min) : "–"}</span>
            <CoverageBadge day={d} />
          </button>
        ))}
      </div>
      <ErrorBox error={items.error} />
      {items.loading && !items.data ? <Loading /> : day && (
        <DayWorkLog user={user} day={day} items={dayItems} editable={editable} onChanged={() => { items.reload(); bumpData(); }} />
      )}
    </div>
  );
}

/** One day: coverage bar, item list, add/edit form. Also used by the dashboard for today. */
export function DayWorkLog({ user, day, items, editable, onChanged, compact }: {
  user: User; day: Day; items: WorkItem[]; editable: boolean; onChanged: () => void; compact?: boolean;
}) {
  const cfg = worklogConfig();
  const self = user.id === me.value?.user.id;
  const [editing, setEditing] = useState<WorkItem | "new" | null>(null);
  const [removing, setRemoving] = useState<WorkItem | null>(null);
  const { run } = useAction();
  const annotated = items.reduce((a, w) => a + w.minutes, 0);
  const remaining = Math.max(0, Math.round(day.worked_min - annotated));
  const pct = day.worked_min > 0 ? Math.min(100, (annotated / day.worked_min) * 100) : 0;
  const required = day.worklog_required_min;
  return (
    <div class="stack">
      {!compact && <div class="row between wrap"><strong>{fmtDate(day.date, { weekday: "long", day: "numeric", month: "long" })}</strong></div>}
      {day.worked_min > 0 ? (
        <div>
          <div class="row between small">
            <span class="muted">{t("worklog.coverage", { done: fmtDuration(annotated), worked: fmtDuration(day.worked_min) })}</span>
            {required > 0 && <span class={annotated >= required ? "pos" : "neg"}>{annotated >= required ? t("worklog.requirement_met") : t("worklog.requirement_missing", { missing: fmtDuration(required - annotated) })}</span>}
          </div>
          <div class="progress" style="margin-top:6px"><span style={{ width: `${pct}%`, background: required > 0 && annotated < required ? "var(--color-break)" : undefined }} /></div>
        </div>
      ) : <div class="small muted">{t("worklog.no_work")}</div>}
      {items.length > 0 && (
        <div class="stack sm">
          {items.map((w) => (
            <div key={w.id} class="row worklog-item">
              <span class="dot" style={{ background: w.project?.color || "var(--color-faint)" }} />
              <div class="grow">
                <div>{w.start_time && <span class="mono small muted" style="margin-right:8px">{fmtTimeOfDay(w.start_time)}–{fmtTimeOfDay(w.end_time)}</span>}
                  {w.project && <strong>{w.project.name}</strong>}
                  {w.customer_ref && <><span class="tiny muted">{t("worklog.customer_short")}</span> <strong>{w.customer_ref}</strong></>}
                  {(w.project || w.customer_ref) && w.note && " · "}{w.note}</div>
              </div>
              <span class="num small">{fmtDuration(w.minutes)}</span>
              {editable && <>
                <button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.edit")} onClick={() => setEditing(w)}><Icon.edit /></button>
                <button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.delete")} onClick={() => setRemoving(w)}><Icon.trash /></button>
              </>}
            </div>
          ))}
        </div>
      )}
      {editable && editing === null && (
        <div><button class="btn btn-sm" onClick={() => setEditing("new")}><Icon.plus />{t("worklog.add")}</button></div>
      )}
      {editable && editing !== null && (
        <WorkLogForm user={user} date={day.date} item={editing === "new" ? null : editing} defaultMinutes={remaining || Math.round(day.worked_min) || 60}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      )}
      {removing && <Confirm danger title={t("worklog.delete_title")} message={`${removing.project?.name || removing.customer_ref || ""}${(removing.project || removing.customer_ref) && removing.note ? " · " : ""}${removing.note} (${fmtDuration(removing.minutes)})`}
        confirmLabel={t("common.delete")} requireReason={!self} onClose={() => setRemoving(null)}
        onConfirm={async (reason) => { await run(() => api.del(`/worklog/${removing.id}`, { reason }), t("worklog.deleted")); onChanged(); }} />}
      {cfg.mode === "required" && !day.worklog_ok && <div class="alert warn small">{t("worklog.day_incomplete", { percent: cfg.percent })}</div>}
    </div>
  );
}

let projectCache: { at: number; list: Project[] } | null = null;

export function useProjects(includeInactive = false) {
  return useAsync(async () => {
    if (!includeInactive && projectCache && Date.now() - projectCache.at < 60000) return projectCache.list;
    const list = await api.get<Project[]>("/projects", { include_inactive: includeInactive ? 1 : undefined });
    if (!includeInactive) projectCache = { at: Date.now(), list };
    return list;
  }, [includeInactive, dataVersion.value]);
}

export function invalidateProjects() {
  projectCache = null;
}

/** Minutes between two "HH:MM" strings of the same day; 0 when incomplete or not after each other. */
function timedMinutes(start: string, end: string): number {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return 0;
  const [sh, sm] = start.split(":").map(Number); const [eh, em] = end.split(":").map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

function WorkLogForm({ user, date, item, defaultMinutes, onClose, onSaved }: {
  user: User; date: string; item: WorkItem | null; defaultMinutes: number; onClose: () => void; onSaved: () => void;
}) {
  const cfg = worklogConfig();
  const self = user.id === me.value?.user.id;
  const projects = useProjects();
  const [projectId, setProjectId] = useState<number | null>(item?.project_id ?? null);
  const [refMode, setRefMode] = useState<"project" | "customer">(item?.customer_ref ? "customer" : "project");
  const [customerRef, setCustomerRef] = useState(item?.customer_ref ?? "");
  const refs = useAsync(() => (self ? api.get<string[]>("/worklog/customer-refs") : Promise.resolve([] as string[])), [self]);
  const [minutes, setMinutes] = useState(item?.minutes ?? defaultMinutes);
  const [mode, setMode] = useState<"duration" | "times">(item?.start_time ? "times" : "duration");
  const [start, setStart] = useState(item?.start_time ?? "");
  const [end, setEnd] = useState(item?.end_time ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [reason, setReason] = useState("");
  const { busy, run, fieldErrors, error } = useAction();
  const list = useMemo(() => {
    const l = projects.data || [];
    return item?.project && !l.find((p) => p.id === item.project!.id) ? [item.project, ...l] : l;
  }, [projects.data, item]);
  async function save(e: Event) {
    e.preventDefault();
    const ref = refMode === "customer" ? { project_id: null, customer_ref: customerRef.trim() } : { project_id: projectId, customer_ref: "" };
    const body: Record<string, unknown> = mode === "times"
      ? { date, start_time: start, end_time: end, ...ref, note, reason }
      : { date, minutes, start_time: null, end_time: null, ...ref, note, reason };
    if (!self && !item) body.user_id = user.id;
    const r = await run(() => (item ? api.patch(`/worklog/${item.id}`, body) : api.post("/worklog", body)), t("common.saved"));
    if (r) onSaved();
  }
  return (
    <form class="card flat stack" style="background:var(--color-surface-2)" onSubmit={save}>
      <ErrorBox error={error} />
      <div class="form-grid">
        <Field label={refMode === "customer" ? t("worklog.customer") : t("worklog.project")} error={fieldErrors.project_id || fieldErrors.customer_ref}
          help={refMode === "customer" ? t("worklog.customer_help") : cfg.project_required ? t("worklog.project_or_customer_required") : t("common.optional")}>
          <div class="stack sm">
            <Segmented value={refMode} onChange={setRefMode} options={[{ value: "project", label: t("worklog.project") }, { value: "customer", label: t("worklog.customer_short") }]} />
            {refMode === "customer" ? (
              <>
                <input class="input" list="worklog-customer-refs" maxLength={60} value={customerRef} placeholder={t("worklog.customer_placeholder")}
                  aria-label={t("worklog.customer")} onInput={(e) => setCustomerRef(val(e))} />
                <datalist id="worklog-customer-refs">{(refs.data || []).map((r) => <option key={r} value={r} />)}</datalist>
              </>
            ) : (
              <SearchPicker items={list} value={projectId} onChange={setProjectId} getId={(p) => p.id}
                getLabel={(p) => (p.is_active ? p.name : `${p.name} – ${t("worklog.inactive")}`)} getSearch={(p) => p.code}
                getSub={(p) => [p.code, p.team_name || t("worklog.company_wide")].filter(Boolean).join(" · ")}
                renderIcon={(p) => <span class="dot" style={{ background: p.color, flex: "none" }} />}
                placeholder={t("worklog.no_project")} ariaLabel={t("worklog.project")} style="width:100%" />
            )}
          </div>
        </Field>
        <Field label={t("worklog.minutes")} error={fieldErrors.minutes || fieldErrors.start_time || fieldErrors.end_time}
          help={mode === "times" ? t("worklog.times_help", { duration: timedMinutes(start, end) > 0 ? fmtDuration(timedMinutes(start, end)) : "–" }) : undefined}>
          <div class="stack sm">
            <Segmented value={mode} onChange={setMode} options={[{ value: "duration", label: t("worklog.mode_duration") }, { value: "times", label: t("worklog.mode_times") }]} />
            {mode === "times" ? (
              <div class="row" style="gap:8px">
                <TimeInput value={start} onChange={setStart} required ariaLabel={t("worklog.from")} />
                <span class="muted">–</span>
                <TimeInput value={end} onChange={setEnd} required ariaLabel={t("worklog.to")} />
              </div>
            ) : <DurationInput value={minutes} onChange={setMinutes} />}
          </div>
        </Field>
      </div>
      <Field label={t("worklog.note")} error={fieldErrors.note} help={t("worklog.note_help")}>
        <textarea class="textarea" rows={2} maxLength={2000} value={note} placeholder={t("worklog.note_placeholder")} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
      </Field>
      {!self && <Field label={t("common.reason")} help={t("common.optional")}><input class="input" value={reason} onInput={(e) => setReason(val(e))} /></Field>}
      <div class="row end">
        <button type="button" class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
        <button class="btn btn-primary" disabled={busy || (mode === "times" ? timedMinutes(start, end) <= 0 : minutes <= 0)}>{t("common.save")}</button>
      </div>
    </form>
  );
}

/** Dashboard card for today (shown when the work log is on); opens automatically after clocking out
 *  when the requirement is not met. */
export function TodayWorkLog({ day }: { day: Day }) {
  const cfg = worklogConfig();
  const user = me.value!.user;
  const items = useAsync(() => api.get<{ items: WorkItem[] }>("/worklog", { from: day.date, to: day.date }), [day.date, dataVersion.value]);
  if (cfg.mode === "off") return null;
  return (
    <div class="card worklog-today">
      <div class="card-head">
        <div><h2><Icon.file width={18} />{t("worklog.today_title")}</h2><p class="card-sub">{cfg.mode === "required" ? t("worklog.sub_required", { percent: cfg.percent }) : t("worklog.sub_optional")}</p></div>
        <a class="small" href="/time">{t("worklog.open_week")}</a>
      </div>
      <ErrorBox error={items.error} />
      {items.loading && !items.data ? <Loading /> : (
        <DayWorkLog user={user} day={day} items={items.data?.items || []} editable compact onChanged={() => { items.reload(); bumpData(); }} />
      )}
    </div>
  );
}
