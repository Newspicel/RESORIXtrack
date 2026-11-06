// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Avatar, Confirm, Duration, Empty, ErrorBox, Field, Loading, Modal, PageHead, useAction, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { t, tError } from "../lib/i18n";
import { me, toast } from "../lib/store";
import { addMonths, fmtDate, fmtDateTime, fmtDuration } from "../lib/time";

export function SignoffPage() {
  return (
    <Shell active="signoff" title={t("nav.signoff")} managerOnly>
      <Signoff />
    </Shell>
  );
}

function previousMonth(): string {
  return addMonths(new Date().toISOString().slice(0, 10), -1).slice(0, 7);
}

function Signoff() {
  const [month, setMonth] = useState(previousMonth());
  const [teamId, setTeamId] = useState<string>("");
  const [selected, setSelected] = useState<number[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [reopen, setReopen] = useState<any>(null);
  const teams = useAsync(() => api.get<any[]>("/teams"), []);
  const ov = useAsync(() => api.get<any>("/signoffs/overview", { month, team_id: teamId || undefined }), [month, teamId]);
  const admin = (me.value!.permissions.admin || me.value!.permissions.hr);
  const tz = me.value!.user.timezone;
  const rows: any[] = ov.data?.rows || [];
  const signable = rows.filter((r) => r.can_sign && r.blockers.length === 0);
  const toggle = (id: number) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const monthLabel = fmtDate(`${month}-01`, { month: "long", year: "numeric" });

  async function signSelected(note: string) {
    const r = await api.post<any>("/signoffs", { month, user_ids: selected, note });
    const okCount = r.results.filter((x: any) => x.ok).length;
    const failed = r.results.filter((x: any) => !x.ok);
    if (okCount) toast(t("signoff.signed_ok", { count: okCount, month: monthLabel }));
    for (const f of failed) toast(tError(f.error), "error", 7000);
    setSelected([]);
    ov.reload();
  }

  return (
    <div class="stack lg">
      <PageHead title={t("signoff.title")} sub={t("signoff.sub")} actions={
        <div class="row wrap">
          {(teams.data || []).length > 1 && (
            <select class="select" style="width:auto" value={teamId} onChange={(e) => { setTeamId((e.target as HTMLSelectElement).value); setSelected([]); }}>
              <option value="">{t("signoff.all_teams")}</option>
              {(teams.data || []).map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
          )}
          <div class="row" style="gap:4px">
            <button class="btn btn-ghost btn-icon btn-sm" aria-label={t("common.previous")} onClick={() => { setMonth(addMonths(`${month}-01`, -1).slice(0, 7)); setSelected([]); }}><Icon.chevronLeft /></button>
            <strong style="min-width:140px;text-align:center">{monthLabel}</strong>
            <button class="btn btn-ghost btn-icon btn-sm" aria-label={t("common.next_period")} onClick={() => { setMonth(addMonths(`${month}-01`, 1).slice(0, 7)); setSelected([]); }}><Icon.chevronRight /></button>
          </div>
        </div>
      } />

      <div class="alert row" style="gap:10px;align-items:flex-start">
        <Icon.shield width={18} style="flex:none;margin-top:2px" />
        <span>{t("signoff.explain")}</span>
      </div>

      <div class="card pad-0">
        <div class="row between wrap" style="padding:16px 20px">
          <h2>{t("signoff.people", { month: monthLabel })}</h2>
          <div class="row">
            {signable.length > 0 && (
              <button class="btn btn-ghost btn-sm" onClick={() => setSelected(selected.length === signable.length ? [] : signable.map((r) => r.user.id))}>
                {selected.length === signable.length ? t("signoff.select_none") : t("signoff.select_all")}
              </button>
            )}
            <button class="btn btn-primary" disabled={selected.length === 0} onClick={() => setConfirm(true)}>
              <Icon.lock />{t("signoff.sign_selected", { count: selected.length })}
            </button>
          </div>
        </div>
        <ErrorBox error={ov.error} />
        {ov.loading && !ov.data ? <Loading /> : ov.error ? null : rows.length === 0 ? <Empty icon={<Icon.team />} title={t("signoff.nobody")} /> : (
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th style="width:36px" /><th>{t("common.name")}</th><th class="n">{t("time.target")}</th><th class="n">{t("time.worked")}</th><th class="n">{t("time.delta")}</th><th>{t("common.status")}</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const so = r.signoff;
                  const canPick = r.can_sign && r.blockers.length === 0;
                  return (
                    <tr key={r.user.id}>
                      <td>{canPick && <input type="checkbox" aria-label={r.user.name} checked={selected.includes(r.user.id)} onChange={() => toggle(r.user.id)} style="width:17px;height:17px;accent-color:var(--color-brand)" />}</td>
                      <td>
                        <a href={`/team/member?id=${r.user.id}&date=${month}-01&view=month`} class="row" style="gap:10px;color:inherit;text-decoration:none">
                          <Avatar name={r.user.name} size="sm" />
                          <span><span style="font-weight:560">{r.user.name}</span>{r.user.team_name && <span class="tiny muted" style="display:block">{r.user.team_name}</span>}</span>
                        </a>
                      </td>
                      <td class="n">{fmtDuration(r.summary.target_min)}</td>
                      <td class="n">{fmtDuration(r.summary.worked_min)}</td>
                      <td class="n"><Duration min={r.summary.delta_min} signed /></td>
                      <td>
                        {so ? (
                          <span class="row" style="gap:6px"><span class="badge ok"><Icon.lock width={12} />{t("signoff.signed")}</span>
                            <span class="tiny muted">{so.signed_by?.name} · {fmtDateTime(so.signed_at, tz)}</span></span>
                        ) : r.blockers.length ? (
                          <span class="row wrap" style="gap:4px">{r.blockers.map((b: string) => <span key={b} class="badge warn" title={t(`errors.${b}`)}>{t(`signoff.blocker.${b}`)}</span>)}</span>
                        ) : !r.can_sign ? (
                          <span class="badge">{r.user.id === me.value?.user.id ? t("signoff.own_month") : t("signoff.not_allowed")}</span>
                        ) : <span class="badge brand">{t("signoff.open")}</span>}
                      </td>
                      <td class="n">{so && admin && <button class="btn btn-ghost btn-sm" onClick={() => setReopen(so)}>{t("signoff.reopen")}</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {admin && <IntegrityCard />}

      {confirm && <Confirm title={t("signoff.confirm_title", { count: selected.length, month: monthLabel })}
        message={t("signoff.confirm_message")} confirmLabel={t("signoff.confirm_button")} requireReason={false} reasonLabel={t("signoff.note_label")}
        onClose={() => setConfirm(false)} onConfirm={(note) => signSelected(note)} />}
      {reopen && <ReopenModal so={reopen} onClose={() => setReopen(null)} onDone={() => { setReopen(null); ov.reload(); }} />}
    </div>
  );
}

function ReopenModal({ so, onClose, onDone }: { so: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, run } = useAction();
  return (
    <Modal title={t("signoff.reopen_title", { name: so.user_name, month: fmtDate(`${so.month}-01`, { month: "long", year: "numeric" }) })} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-danger" disabled={busy || !reason.trim()} onClick={async () => {
        if (await run(() => api.post(`/signoffs/${so.id}/reopen`, { reason }), t("signoff.reopened_ok"))) onDone();
      }}>{t("signoff.reopen")}</button>
    </>}>
      <div class="stack">
        <div class="alert warn small">{t("signoff.reopen_help")}</div>
        <Field label={<span class="row" style="gap:8px">{t("common.reason")}<span class="badge danger">{t("common.required")}</span></span>}>
          <textarea class="textarea" value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
        </Field>
      </div>
    </Modal>
  );
}

function IntegrityCard() {
  const [result, setResult] = useState<any>(null);
  const { busy, run } = useAction();
  const tz = me.value!.user.timezone;
  return (
    <div class="card">
      <div class="card-head">
        <h2><Icon.shield width={18} />{t("signoff.integrity_title")}</h2>
        <button class="btn btn-sm" disabled={busy} onClick={async () => { const r = await run(() => api.get("/signoffs/verify")); if (r) setResult(r); }}>
          <Icon.refresh />{t("signoff.integrity_run")}
        </button>
      </div>
      <p class="small muted">{t("signoff.integrity_help")}</p>
      {result && (
        <div class="stack" style="margin-top:14px">
          <div class={`alert ${result.ok ? "" : "error"}`}>
            {result.ok ? t("signoff.integrity_ok", { n: result.counts.intact }) : t("signoff.integrity_problems")}
            {result.guards.missing.length > 0 && <div class="small">{t("signoff.guards_missing", { n: result.guards.missing.length })}</div>}
          </div>
          {result.problems.map((p: any) => (
            <div key={p.id} class="row small">
              <span class="badge danger">{t(`signoff.status.${p.integrity}`)}</span>
              <span>{p.user_name} · {p.month}</span>
              <span class="muted">{t("signoff.signed_by_on", { name: p.signed_by?.name || "?", date: fmtDateTime(p.signed_at, tz) })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
