// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Avatar, Confirm, Empty, ErrorBox, Field, Loading, Modal, StatusBadge, useAction, useAsync } from "../components/ui";
import { AbsenceHistoryModal } from "../components/absence_history";
import { absenceRange } from "../lib/absence";
import { api } from "../lib/api";
import { absenceLabel, t, tError } from "../lib/i18n";
import { me, pendingApprovals, toast, tz } from "../lib/store";
import { addDays, fmtDate, fmtDateTime, fmtDays, todayIn } from "../lib/time";

export function ApprovalsPage() {
  return (
    <Shell active="approvals" title={t("nav.approvals")} managerOnly>
      <Approvals />
    </Shell>
  );
}

function Approvals() {
  const pending = useAsync(async () => {
    const list = await api.get<any[]>("/absences/pending");
    pendingApprovals.value = list.length;
    return list;
  }, []);
  const today = todayIn(tz());
  const upcoming = useAsync(() => api.get<any[]>("/absences", { from: today, to: addDays(today, 180), status: "approved,pending" }), []);
  const [cancel, setCancel] = useState<any | null>(null);
  const [history, setHistory] = useState<any | null>(null);

  function reloadAll() {
    pending.reload();
    upcoming.reload();
  }

  return (
    <div class="stack lg">
      <div class="page-head">
        <div>
          <h1>{t("team.approvals_title")}</h1>
          <p class="muted">{t("team.approvals_sub")}</p>
        </div>
      </div>

      <section class="stack">
        <h2>{t("team.inbox")} {pending.data && pending.data.length > 0 && <span class="badge warn">{pending.data.length}</span>}</h2>
        <ErrorBox error={pending.error} />
        {pending.loading && !pending.data ? <Loading /> : pending.data && pending.data.length === 0 ? (
          <div class="card"><Empty icon={<Icon.check />} title={t("team.inbox_empty")}>{t("team.inbox_empty_sub")}</Empty></div>
        ) : (
          <div class="grid cols-2">
            {pending.data?.map((a) => <RequestCard key={a.id} a={a} onDone={reloadAll} onHistory={() => setHistory(a)} />)}
          </div>
        )}
      </section>

      <section class="card pad-0">
        <div class="card-head" style="padding:20px 20px 0">
          <h2>{t("team.upcoming")}</h2>
          <span class="card-sub">{t("team.upcoming_sub")}</span>
        </div>
        <ErrorBox error={upcoming.error} />
        {upcoming.loading && !upcoming.data ? <Loading /> : upcoming.data && upcoming.data.length === 0 ? <Empty title={t("team.upcoming_empty")} /> : (
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>{t("common.name")}</th><th>{t("common.type")}</th><th>{t("team.period")}</th><th class="n">{t("common.days")}</th><th>{t("common.status")}</th><th class="n">{t("common.actions")}</th></tr></thead>
              <tbody>
                {upcoming.data?.map((a) => (
                  <tr key={a.id}>
                    <td><div class="row" style="gap:10px"><Avatar name={a.user.name} size="sm" /><a href={`/team/member?id=${a.user.id}`} style="color:inherit;font-weight:560">{a.user.name}</a></div></td>
                    <td><span class="chip" style={{ background: a.type.color }}>{absenceLabel(a.type)}</span></td>
                    <td class="nowrap">{absenceRange(a)}</td>
                    <td class="n">{fmtDays(a.days)}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td class="n">
                      <div class="row end" style="gap:4px">
                        <button class="btn btn-ghost btn-sm btn-icon" title={t("team.history")} aria-label={t("team.history")} onClick={() => setHistory(a)}><Icon.history /></button>
                        {a.permissions?.cancel && <button class="btn btn-danger btn-sm" onClick={() => setCancel(a)}>{t("team.cancel")}</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {cancel && (
        <Confirm title={t("team.cancel_title", { name: cancel.user.name })} danger confirmLabel={t("team.cancel_confirm")} cancelLabel={t("absences.keep")}
          message={<>{absenceLabel(cancel.type)} · {absenceRange(cancel)}<br />{t("team.cancel_message")}</>}
          requireReason={cancel.user.id !== me.value?.user.id}
          onClose={() => setCancel(null)}
          onConfirm={async (reason) => {
            try {
              await api.post(`/absences/${cancel.id}/cancel`, { reason });
              toast(t("team.cancelled"));
              reloadAll();
            } catch (e: any) {
              toast(tError(e), "error");
              throw e;
            }
          }} />
      )}
      {history && <AbsenceHistoryModal absence={history} tz={tz()} onClose={() => setHistory(null)} />}
    </div>
  );
}

function RequestCard({ a, onDone, onHistory }: { a: any; onDone: () => void; onHistory: () => void }) {
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const preview = useAsync(() => a.type.deducts_vacation
    ? api.get<any>("/absences/preview", { user_id: a.user.id, type: a.type.key, start_date: a.start_date, end_date: a.end_date, start_half: a.start_half, end_half: a.end_half })
    : Promise.resolve(null), [a.id]);
  const overlaps = useAsync(async () => {
    const end = a.end_date < addDays(a.start_date, 92) ? a.end_date : addDays(a.start_date, 92);
    const cal = await api.get<any>("/calendar/team", { from: a.start_date, to: end, team_id: a.user.team_id || "" });
    const out: { name: string; label: string; color: string; days: number }[] = [];
    for (const r of cal.rows) {
      if (r.user.id === a.user.id) continue;
      let days = 0;
      let first: any = null;
      for (const d of r.days) for (const x of d.absences) {
        if (x.status !== "approved" && x.status !== "pending") continue;
        if (!d.workday) continue;
        days += x.halves.length === 1 ? 0.5 : 1;
        first ||= x;
      }
      if (days > 0) out.push({ name: r.user.name, label: absenceLabel({ key: first.type, label: first.label }), color: first.color, days });
    }
    return out;
  }, [a.id]);
  const after = preview.data?.vacation_after;
  return (
    <div class="card stack">
      <div class="row">
        <Avatar name={a.user.name} />
        <div class="grow">
          <div style="font-weight:620">{a.user.name}</div>
          <div class="small muted">{t("team.requested_at", { when: fmtDateTime(a.created_at, tz()) })}</div>
        </div>
        <span class="chip" style={{ background: a.type.color }}>{absenceLabel(a.type)}</span>
      </div>
      <div>
        <div style="font-weight:600;font-size:1.05rem">{absenceRange(a)}</div>
        <div class="small muted">{t("absences.n_days", { count: a.days, n: fmtDays(a.days) })}
          {a.type.deducts_vacation && after !== undefined && <> · <span class={after < 0 ? "danger-text" : ""}>{t("team.vacation_after", { n: fmtDays(after) })}</span></>}
        </div>
      </div>
      {a.note && <div class="alert" style="white-space:pre-wrap">“{a.note}”</div>}
      {a.type.deducts_vacation && after !== undefined && after < 0 && <div class="alert warn">{t("team.exceeds_vacation")}</div>}
      {overlaps.data && overlaps.data.length > 0 && (
        <div class="alert warn small">
          <strong>{t("team.overlap_hint")}</strong>
          <div class="stack sm" style="margin-top:6px">
            {overlaps.data.map((o) => <div key={o.name} class="row" style="gap:8px"><span class="dot" style={{ background: o.color }} />{o.name} · {o.label} · {t("absences.n_days", { count: o.days, n: fmtDays(o.days) })}</div>)}
          </div>
        </div>
      )}
      {overlaps.data && overlaps.data.length === 0 && <div class="small muted row" style="gap:6px"><Icon.check width={15} />{t("team.no_overlap")}</div>}
      <div class="row wrap" style="margin-top:4px">
        <button class="btn btn-primary" onClick={() => setDecision("approve")}><Icon.check />{t("team.approve")}</button>
        <button class="btn btn-danger" onClick={() => setDecision("reject")}><Icon.x />{t("team.reject")}</button>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto" onClick={onHistory}><Icon.history />{t("team.history")}</button>
      </div>
      {decision && <DecideModal a={a} kind={decision} onClose={() => setDecision(null)} onDone={onDone} />}
    </div>
  );
}

function DecideModal({ a, kind, onClose, onDone }: { a: any; kind: "approve" | "reject"; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const { busy, run } = useAction();
  async function submit() {
    const r = await run(() => api.post(`/absences/${a.id}/${kind}`, { note }), kind === "approve" ? t("team.approved_toast", { name: a.user.name }) : t("team.rejected_toast", { name: a.user.name }));
    if (r) {
      onClose();
      onDone();
    }
  }
  return (
    <Modal title={kind === "approve" ? t("team.approve_title") : t("team.reject_title")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class={`btn ${kind === "approve" ? "btn-primary" : "btn-danger"}`} disabled={busy} onClick={submit}>{kind === "approve" ? t("team.approve") : t("team.reject")}</button>
    </>}>
      <div class="stack">
        <div class="muted">{a.user.name} · {absenceLabel(a.type)} · {absenceRange(a)}</div>
        <Field label={t("team.decision_note")} help={t("team.decision_note_help")}>
          <textarea class="textarea" value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
        </Field>
      </div>
    </Modal>
  );
}

const ACTION_ICONS: Record<string, string> = { create: "pin", approve: "pin", update: "pin other", reject: "pin del", cancel: "pin del" };

