// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Confirm, Empty, Field, Loading, Modal, PageHead, StatusBadge, useAction, useAsync } from "../components/ui";
import { AbsenceHistoryModal } from "../components/absence_history";
import { halfSuffix } from "../lib/absence";
import { AbsenceCalendar } from "../components/absence_calendar";
import { api } from "../lib/api";
import { absenceLabel, t } from "../lib/i18n";
import { bumpData, dataVersion, me, toast, type User } from "../lib/store";
import { addDays, fmtDate, fmtDateTime, fmtDays, todayIn } from "../lib/time";

export function AbsencesPage() {
  return (
    <Shell active="absences" title={t("nav.absences")}>
      <SelfAbsences />
    </Shell>
  );
}

function SelfAbsences() {
  return <AbsencesView user={me.value!.user} />;
}

export interface AbsenceType {
  id: number; key: string; label: string; color: string; category: string; requires_approval: boolean;
  allows_attachments: boolean; employee_can_request: boolean; deducts_vacation: boolean; is_active: boolean;
}

export interface Absence {
  id: number; user: { id: number; name: string }; type: AbsenceType; start_date: string; end_date: string;
  start_half: string; end_half: string; days: number; note: string; status: string;
  requested_by: { id: number; name: string } | null; decided_by: { id: number; name: string } | null;
  decided_at: string | null; decision_note: string; cancelled_by: { id: number; name: string } | null; cancel_reason: string;
  attachments: { id: number; filename: string; size: number; url: string; content_type: string; created_at: string }[];
  permissions?: { cancel: boolean; decide: boolean; edit: boolean; attach: boolean };
}

export function AbsencesView({ user }: { user: User }) {
  const self = user.id === me.value?.user.id;
  const tz = user.timezone;
  const today = todayIn(tz);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [requesting, setRequesting] = useState<null | "vacation" | "sick">(null);
  const list = useAsync(() => api.get<Absence[]>("/absences", {
    from: `${year}-01-01`, to: `${year + 1}-12-31`, user_id: user.id, status: "pending,approved,rejected,cancelled",
  }), [year, user.id, dataVersion.value]);
  const vac = useAsync(() => api.get<any>(`/accounts/${user.id}/vacation`, { year }), [year, user.id, dataVersion.value]);
  const sick = useAsync(() => (self ? api.get<{ allowed: boolean; reason: string | null }>("/absences/sick-check") : Promise.resolve(null)), [dataVersion.value]);

  const items = list.data || [];
  const upcoming = items.filter((a) => a.end_date >= today && ["pending", "approved"].includes(a.status)).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const past = items.filter((a) => !upcoming.includes(a) && a.start_date.slice(0, 4) === String(year)).sort((a, b) => b.start_date.localeCompare(a.start_date));

  return (
    <div class="stack lg">
      {self && (
        <PageHead title={t("absences.title")} sub={t("absences.sub")} actions={<>
          {sick.data && sick.data.allowed && <button class="btn" onClick={() => setRequesting("sick")}><Icon.thermo />{t("absences.report_sick")}</button>}
          <button class="btn btn-primary" onClick={() => setRequesting("vacation")}><Icon.plus />{t("absences.request")}</button>
        </>} />
      )}
      {!self && (
        <div class="row end">
          <button class="btn btn-primary" onClick={() => setRequesting("vacation")}><Icon.plus />{t("absences.record_for", { name: user.name })}</button>
        </div>
      )}
      {self && sick.data && !sick.data.allowed && sick.data.reason === "already_sick" && (
        <div class="alert">{t("absences.sick_not_allowed.already_sick")} {t("dashboard.get_well")}</div>
      )}

      <div class="grid cols-3">
        <div class="card" style="grid-column: span 2">
          <div class="card-head"><h2>{t("absences.upcoming")}</h2></div>
          {list.loading && !list.data ? <Loading /> : upcoming.length === 0 ? <Empty icon={<Icon.palm />} title={t("absences.none_upcoming")} /> : (
            <div class="stack">{upcoming.map((a) => <AbsenceItem key={a.id} a={a} tz={tz} onChange={() => { list.reload(); vac.reload(); }} />)}</div>
          )}
        </div>
        <VacationCard data={vac.data} year={year} setYear={setYear} />
      </div>

      <div class="card">
        <div class="card-head"><h2>{t("absences.past")} {year}</h2></div>
        {past.length === 0 ? <div class="muted small">{t("absences.none_past")}</div> : (
          <div class="stack">{past.map((a) => <AbsenceItem key={a.id} a={a} tz={tz} onChange={() => { list.reload(); vac.reload(); }} />)}</div>
        )}
      </div>

      {requesting && <RequestModal user={user} mode={requesting} onClose={() => setRequesting(null)}
        onDone={() => { setRequesting(null); bumpData(); }} />}
    </div>
  );
}

function VacationCard({ data, year, setYear }: { data: any; year: number; setYear: (y: number) => void }) {
  if (!data) return <div class="card"><Loading /></div>;
  const total = data.carried_over + data.entitlement + data.adjustments;
  const used = data.taken + data.planned;
  return (
    <div class="card">
      <div class="card-head">
        <h2>{t("absences.vacation_account", { year })}</h2>
        <div class="row" style="gap:2px">
          <button class="btn btn-ghost btn-icon btn-sm" onClick={() => setYear(year - 1)} aria-label={t("common.previous")}><Icon.chevronLeft /></button>
          <button class="btn btn-ghost btn-icon btn-sm" onClick={() => setYear(year + 1)} aria-label={t("common.next_period")}><Icon.chevronRight /></button>
        </div>
      </div>
      <div class="stat" style="margin-bottom:14px">
        <div class="value">{fmtDays(data.remaining)} <span class="small muted" style="font-weight:500">/ {fmtDays(total)} {t("common.days")}</span></div>
      </div>
      <div class="progress" style="margin-bottom:16px"><span style={{ width: `${total ? Math.min(100, (used / total) * 100) : 0}%` }} /></div>
      <table class="table" style="font-size:.88rem">
        <tbody>
          <tr><td>{t("absences.carried_over")}</td><td class="n">{fmtDays(data.carried_over)}</td></tr>
          <tr><td>{t("absences.entitlement")}</td><td class="n">{fmtDays(data.entitlement)}</td></tr>
          {data.adjustments !== 0 && <tr><td>{t("absences.adjustments")}</td><td class="n">{fmtDays(data.adjustments)}</td></tr>}
          <tr><td>{t("absences.taken")}</td><td class="n">−{fmtDays(data.taken)}</td></tr>
          <tr><td>{t("absences.planned")}</td><td class="n">−{fmtDays(data.planned)}</td></tr>
          <tr><td><strong>{t("absences.remaining")}</strong></td><td class="n"><strong>{fmtDays(data.remaining)}</strong></td></tr>
          {data.pending > 0 && <tr><td class="muted">{t("absences.pending_days")}</td><td class="n muted">{fmtDays(data.pending)}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function AbsenceItem({ a, tz, onChange }: { a: Absence; tz: string; onChange: () => void }) {
  const [cancel, setCancel] = useState(false);
  const [history, setHistory] = useState(false);
  const [editEnd, setEditEnd] = useState(false);
  const [removeDoc, setRemoveDoc] = useState<{ id: number; url: string; filename: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const p = a.permissions || { cancel: false, decide: false, edit: false, attach: false };
  const self = a.user.id === me.value?.user.id;
  const closed = a.status === "cancelled" || a.status === "rejected";
  async function upload(file: File) {
    if (await run(() => api.upload(`/absences/${a.id}/attachments`, file), t("absences.uploaded_ok")) !== undefined) onChange();
  }
  return (
    <div class="row" style={`align-items:flex-start;padding:12px;border-radius:10px;background:var(--color-surface-2);border:1px solid var(--color-border-soft);${closed ? "opacity:.6" : ""}`}>
      <span style={{ width: "4px", alignSelf: "stretch", borderRadius: "2px", background: a.type.color, flex: "none" }} />
      <div class="grow stack sm">
        <div class="row wrap" style="gap:8px">
          <strong>{absenceLabel(a.type)}</strong>
          <StatusBadge status={a.status} />
          <span class="muted small">{t("absences.n_days", { count: a.days, n: fmtDays(a.days) })}</span>
        </div>
        <div class="small">
          {fmtDate(a.start_date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
          {a.end_date !== a.start_date && <> – {fmtDate(a.end_date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</>}
          <span class="muted">{halfSuffix(a)}</span>
        </div>
        {a.note && <div class="small muted">“{a.note}”</div>}
        {a.decided_by && a.status !== "pending" && a.requested_by?.id !== a.decided_by.id && (
          <div class="tiny faint">{t("absences.decided_by", { status: t(`absences.status.${a.status === "cancelled" ? "approved" : a.status}`), name: a.decided_by.name })}{a.decision_note && ` · “${a.decision_note}”`}</div>
        )}
        {a.requested_by && a.requested_by.id !== a.user.id && <div class="tiny faint">{t("absences.requested_by", { name: a.requested_by.name })}</div>}
        {a.status === "cancelled" && a.cancelled_by && <div class="tiny faint">{t("absences.status.cancelled")} · {a.cancelled_by.name}{a.cancel_reason && ` · “${a.cancel_reason}”`}</div>}
        {(a.attachments.length > 0 || (p.attach && a.type.allows_attachments)) && (
          <div class="row wrap" style="gap:6px;margin-top:4px">
            {a.attachments.map((f) => (
              <span key={f.id} class="badge" style="height:26px">
                <Icon.paperclip width={13} />
                <a href={`${f.url}?inline=1`} target="_blank" rel="noopener">{f.filename}</a>
                <a href={f.url} aria-label={t("common.download")}><Icon.download width={13} /></a>
                {p.attach && <button class="btn btn-ghost btn-icon btn-sm" style="width:20px;height:20px" aria-label={t("absences.delete_attachment")}
                  onClick={() => setRemoveDoc(f)}><Icon.x width={12} /></button>}
              </span>
            ))}
            {p.attach && a.type.allows_attachments && (
              <>
                <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/heic" class="sr-only"
                  onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) upload(f); (e.target as HTMLInputElement).value = ""; }} />
                <button class="btn btn-ghost btn-sm" disabled={busy} onClick={() => fileRef.current?.click()} title={t("absences.attach_help")}>
                  <Icon.upload />{t("absences.attach")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div class="row" style="gap:4px">
        {p.edit && a.type.category === "sick" && <button class="btn btn-ghost btn-sm" onClick={() => setEditEnd(true)}>{t("absences.extend")}</button>}
        <button class="btn btn-ghost btn-icon btn-sm" aria-label={t("absences.history")} onClick={() => setHistory(true)}><Icon.history /></button>
        {p.cancel && <button class="btn btn-ghost btn-icon btn-sm" aria-label={t("absences.cancel")} onClick={() => setCancel(true)}><Icon.x /></button>}
      </div>
      {removeDoc && <Confirm danger title={t("absences.delete_attachment_title", { name: removeDoc.filename })} message={t("absences.delete_attachment_message")}
        confirmLabel={t("absences.delete_attachment")} onClose={() => setRemoveDoc(null)}
        onConfirm={async () => { if (await run(() => api.del(removeDoc.url.replace("/api/v1", "")))) onChange(); }} />}
      {cancel && <Confirm title={t("absences.cancel_confirm")} cancelLabel={t("absences.keep")} message={self ? undefined : t("absences.cancel_manager_help")}
        confirmLabel={t("absences.cancel")} danger requireReason={!self}
        onClose={() => setCancel(false)}
        onConfirm={async (reason) => { await api.post(`/absences/${a.id}/cancel`, { reason }); toast(t("absences.cancelled_ok")); bumpData(); onChange(); }} />}
      {history && <AbsenceHistoryModal absence={a} tz={tz} onClose={() => setHistory(false)} />}
      {editEnd && <EndDateModal a={a} onClose={() => setEditEnd(false)} onSaved={() => { setEditEnd(false); bumpData(); onChange(); }} />}
    </div>
  );
}

function EndDateModal({ a, onClose, onSaved }: { a: Absence; onClose: () => void; onSaved: () => void }) {
  const [end, setEnd] = useState(a.end_date);
  const [reason, setReason] = useState("");
  const self = a.user.id === me.value?.user.id;
  const { busy, run } = useAction();
  return (
    <Modal title={t("absences.extend")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-primary" disabled={busy || (!self && !reason.trim())} onClick={async () => {
        if (await run(() => api.patch(`/absences/${a.id}`, { end_date: end, end_half: "full", reason }), t("common.saved")) !== undefined) onSaved();
      }}>{t("common.save")}</button>
    </>}>
      <div class="stack">
        <Field label={t("absences.end")}><input type="date" class="input" min={a.start_date} value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} /></Field>
        {!self && <Field label={t("common.reason")} help={t("common.reason_required_help")}><input class="input" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} /></Field>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ request / record

export function RequestModal({ user, mode, onClose, onDone }: { user: User; mode: "vacation" | "sick"; onClose: () => void; onDone: () => void }) {
  const self = user.id === me.value?.user.id;
  const tz = user.timezone;
  const today = todayIn(tz);
  const { data: types } = useAsync(() => api.get<AbsenceType[]>("/absence-types"), []);
  const [type, setType] = useState(mode);
  const [start, setStart] = useState(mode === "sick" ? today : addDays(today, 1));
  const [end, setEnd] = useState(mode === "sick" ? today : addDays(today, 1));
  const [startHalf, setStartHalf] = useState("full");
  const [endHalf, setEndHalf] = useState("full");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const { busy, run, fieldErrors } = useAction();
  const available = (types || []).filter((x) => x.is_active && (!self || x.employee_can_request || me.value?.permissions.admin));
  const selected = available.find((x) => x.key === type);
  const single = start === end;

  useEffect(() => {
    if (!start || !end || end < start) return setPreview(null);
    const h = setTimeout(() => {
      api.get("/absences/preview", { user_id: self ? undefined : user.id, type, start_date: start, end_date: end, start_half: startHalf, end_half: endHalf })
        .then(setPreview).catch(() => setPreview(null));
    }, 200);
    return () => clearTimeout(h);
  }, [type, start, end, startHalf, endHalf]);

  async function submit(e: Event) {
    e.preventDefault();
    const created = await run(() => api.post<Absence>("/absences", {
      user_id: self ? undefined : user.id, type, start_date: start, end_date: end,
      start_half: startHalf, end_half: single ? "full" : endHalf, note,
    }));
    if (!created) return;
    if (file && created.permissions?.attach) await run(() => api.upload(`/absences/${created.id}/attachments`, file));
    toast(created.status === "pending" ? t("absences.requested_ok") : t("absences.recorded_ok"));
    onDone();
  }
  const isSick = selected?.category === "sick";
  return (
    <Modal title={self ? (isSick ? t("absences.report_sick") : t("absences.request")) : t("absences.record_for", { name: user.name })} onClose={onClose} footer={<>
      <button type="button" class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button type="submit" form="abs-form" class="btn btn-primary" disabled={busy || !preview || preview.days <= 0}>
        {selected?.requires_approval && self ? t("absences.submit") : t("absences.submit_record")}
      </button>
    </>}>
      <form id="abs-form" class="stack lg" onSubmit={submit}>
        <Field label={t("absences.type")} error={fieldErrors.type}>
          <select class="select" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as any)}>
            {available.map((x) => <option key={x.key} value={x.key}>{absenceLabel(x)}</option>)}
          </select>
        </Field>
        <div class="form-grid">
          <Field label={t("absences.start")} error={fieldErrors.start_date}>
            <input type="date" class="input" required value={start} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setStart(v); if (end < v) setEnd(v); }} />
          </Field>
          <Field label={t("absences.end")} error={fieldErrors.end_date}>
            <input type="date" class="input" required min={start} value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />
          </Field>
          <div class="full">
            <AbsenceCalendar userId={self ? undefined : user.id} start={start} end={end} today={today} onChange={(s, e) => { setStart(s); setEnd(e); }} />
          </div>
          {single ? (
            <Field label={t("absences.single_day")} class="full">
              <div class="segmented">
                {["full", "am", "pm"].map((h) => <button key={h} type="button" class={startHalf === h ? "active" : ""} onClick={() => setStartHalf(h)}>{t(`absences.half.${h}`)}</button>)}
              </div>
            </Field>
          ) : (
            <>
              <label class="checkbox"><input type="checkbox" checked={startHalf === "pm"} onChange={(e) => setStartHalf((e.target as HTMLInputElement).checked ? "pm" : "full")} />{t("absences.half.start_pm")}</label>
              <label class="checkbox"><input type="checkbox" checked={endHalf === "am"} onChange={(e) => setEndHalf((e.target as HTMLInputElement).checked ? "am" : "full")} />{t("absences.half.end_am")}</label>
            </>
          )}
        </div>
        <Field label={t("absences.note")}>
          <input class="input" maxLength={1000} placeholder={t("absences.note_placeholder")} value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
        </Field>
        {selected?.allows_attachments && (
          <Field label={t("absences.attach")} help={t("absences.attach_help")}>
            <input type="file" class="input" style="padding-top:7px" accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
              onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] || null)} />
          </Field>
        )}
        {preview && (
          <div class={`alert ${selected?.deducts_vacation && preview.vacation_after < 0 ? "warn" : ""}`}>
            <div><strong>{t("absences.preview_days", { n: fmtDays(preview.days) })}</strong></div>
            {selected?.deducts_vacation && <div class="small">{t("absences.preview_after", { n: fmtDays(preview.vacation_after) })}{preview.vacation_after < 0 && ` · ${t("absences.preview_negative")}`}</div>}
            {self && <div class="small muted">{selected?.requires_approval ? t("absences.needs_approval") : t("absences.no_approval")}</div>}
          </div>
        )}
      </form>
    </Modal>
  );
}
