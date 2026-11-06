// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Confirm, Duration, ErrorBox, Field, Loading, Modal, PageHead, Segmented, useAction, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { bumpData, dataVersion, me, type User } from "../lib/store";
import { fmtDate, fmtDays, fmtDuration, monthName, todayIn } from "../lib/time";

export function AccountPage() {
  return (
    <Shell active="account" title={t("nav.account")}>
      <PageHead title={t("account.title")} sub={t("account.sub")} />
      <SelfAccount />
    </Shell>
  );
}

function SelfAccount() {
  return <AccountView user={me.value!.user} />;
}

export function AccountView({ user }: { user: User }) {
  const [year, setYear] = useState(Number(todayIn(user.timezone).slice(0, 4)));
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<any>(null);
  const st = useAsync(() => api.get<any>(`/accounts/${user.id}/time`, { year }), [year, user.id, dataVersion.value]);
  const vac = useAsync(() => api.get<any>(`/accounts/${user.id}/vacation`, { year }), [year, user.id, dataVersion.value]);
  const m = me.value!;
  const self = user.id === m.user.id;
  const canAdjust = m.permissions.hr || (!self && m.permissions.lead && m.permissions.lead_can_adjust_balances);
  const data = st.data;
  const maxAbs = data ? Math.max(60, ...data.months.map((x: any) => Math.abs(x.balance_min))) : 60;
  const adjustments = [...(data?.adjustments || []), ...(vac.data?.adjustment_items || [])].sort((a, b) => b.effective_date.localeCompare(a.effective_date));

  return (
    <div class="stack lg">
      <ErrorBox error={st.error || vac.error} />
      <div class="row between wrap">
        <div class="row" style="gap:4px">
          <button class="btn btn-ghost btn-icon btn-sm" onClick={() => setYear(year - 1)} aria-label={t("common.previous")}><Icon.chevronLeft /></button>
          <h2>{year}</h2>
          <button class="btn btn-ghost btn-icon btn-sm" onClick={() => setYear(year + 1)} aria-label={t("common.next_period")}><Icon.chevronRight /></button>
        </div>
        {canAdjust && <button class="btn" onClick={() => setAdding(true)}><Icon.plus />{t("account.add_adjustment")}</button>}
      </div>
      {!data ? <Loading /> : (
        <>
          <div class="grid cols-4">
            <div class="card stat"><div class="label">{t("account.opening")}</div><div class="value"><Duration min={data.opening_min} signed /></div><div class="hint">{t("account.opening_hint", { year })}</div></div>
            <div class="card stat"><div class="label">{t("account.target_year")}</div><div class="value num">{fmtDuration(data.months.reduce((a: number, x: any) => a + x.target_min, 0))}</div><div class="hint">{t("account.until_yesterday")}</div></div>
            <div class="card stat"><div class="label">{t("account.worked_year")}</div><div class="value num">{fmtDuration(data.months.reduce((a: number, x: any) => a + x.worked_min, 0))}</div><div class="hint">{t("account.credits", { t: fmtDuration(data.months.reduce((a: number, x: any) => a + x.credit_min, 0)) })}</div></div>
            <div class="card stat"><div class="label">{t("account.closing")}</div><div class="value"><Duration min={data.closing_min} signed /></div><div class="hint">{t("account.closing_hint")}</div></div>
          </div>
          <div class="card pad-0">
            <div class="card-head" style="padding:18px 20px 0"><h2>{t("account.statement")}</h2><span class="small muted">{t("account.statement_hint")}</span></div>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>{t("common.month")}</th><th class="n">{t("account.workdays")}</th><th class="n">{t("time.target")}</th><th class="n">{t("time.worked")}</th><th class="n">{t("account.credits_col")}</th><th class="n">{t("time.delta")}</th><th class="n">{t("account.adjustments")}</th><th class="n">{t("account.balance")}</th><th style="width:22%" class="hide-mobile" /></tr></thead>
                <tbody>
                  <tr><td class="muted">{t("account.opening")}</td><td colspan={6} /><td class="n"><Duration min={data.opening_min} signed /></td><td class="hide-mobile" /></tr>
                  {data.months.map((x: any) => (
                    <tr key={x.month}>
                      <td>{monthName(x.month)}</td>
                      <td class="n">{x.workdays}</td>
                      <td class="n">{fmtDuration(x.target_min)}</td>
                      <td class="n">{fmtDuration(x.worked_min)}</td>
                      <td class="n muted">{x.credit_min ? fmtDuration(x.credit_min) : "–"}</td>
                      <td class="n"><Duration min={x.delta_min} signed /></td>
                      <td class="n">{x.adjustments_min ? <Duration min={x.adjustments_min} signed /> : "–"}</td>
                      <td class="n"><strong><Duration min={x.balance_min} signed /></strong></td>
                      <td class="hide-mobile"><BalanceBar value={x.balance_min} max={maxAbs} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h2>{t("account.vacation")}</h2><a class="small" href={self ? "/absences" : `/team/member?id=${user.id}&tab=absences`}>{t("account.to_absences")}</a></div>
          {vac.data ? (
            <div class="grid cols-3" style="gap:10px">
              <Mini label={t("absences.carried_over")} v={fmtDays(vac.data.carried_over)} />
              <Mini label={t("absences.entitlement")} v={fmtDays(vac.data.entitlement) + (vac.data.entitlement_overridden ? " *" : "")} />
              <Mini label={t("absences.adjustments")} v={fmtDays(vac.data.adjustments)} />
              <Mini label={t("absences.taken")} v={fmtDays(vac.data.taken)} />
              <Mini label={t("absences.planned")} v={fmtDays(vac.data.planned)} />
              <Mini label={t("absences.remaining")} v={fmtDays(vac.data.remaining)} strong />
            </div>
          ) : <Loading />}
        </div>
        <div class="card">
          <div class="card-head"><h2>{t("account.adjustment_list")}</h2></div>
          {adjustments.length === 0 ? <div class="muted small">{t("account.no_adjustments")}</div> : (
            <div class="stack">
              {adjustments.map((a: any) => (
                <div key={a.id} class="row" style="align-items:flex-start">
                  <span class="badge">{t(`account.kind.${a.kind}`)}</span>
                  <div class="grow">
                    <div class="small"><strong>{a.account === "time" ? <Duration min={a.amount} signed /> : `${a.amount > 0 ? "+" : ""}${fmtDays(a.amount)} ${t("common.days")}`}</strong> · {fmtDate(a.effective_date)}</div>
                    <div class="small muted">{a.reason}{a.created_by && ` · ${a.created_by.name}`}</div>
                  </div>
                  {canAdjust && <button class="btn btn-ghost btn-icon btn-sm" aria-label={t("common.delete")} onClick={() => setRemoving(a)}><Icon.trash /></button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div class="alert small"><Icon.info width={16} style="vertical-align:-3px;margin-right:6px" />{t("account.explain")}</div>
      {adding && <AdjustmentModal user={user} year={year} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); bumpData(); }} />}
      {removing && <Confirm title={t("account.remove_adjustment")} danger requireReason confirmLabel={t("common.delete")}
        onClose={() => setRemoving(null)} onConfirm={async (reason) => { await api.del(`/adjustments/${removing.id}`, { reason }); bumpData(); }} />}
    </div>
  );
}

function Mini({ label, v, strong }: { label: string; v: string; strong?: boolean }) {
  return (
    <div style="padding:10px 12px;border-radius:10px;background:var(--color-surface-2)">
      <div class="tiny muted">{label}</div>
      <div class="num" style={`font-size:1.15rem;font-weight:${strong ? 750 : 620}`}>{v}</div>
    </div>
  );
}

function BalanceBar({ value, max }: { value: number; max: number }) {
  const w = Math.min(50, (Math.abs(value) / max) * 50);
  return (
    <div style="position:relative;height:8px;background:var(--color-surface-3);border-radius:4px">
      <div style="position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:var(--color-faint)" />
      <div style={{ position: "absolute", top: 0, bottom: 0, borderRadius: "4px", left: value >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: value >= 0 ? "var(--color-pos)" : "var(--color-neg)" }} />
    </div>
  );
}

function AdjustmentModal({ user, year, onClose, onSaved }: { user: User; year: number; onClose: () => void; onSaved: () => void }) {
  const [account, setAccount] = useState<"time" | "vacation">("time");
  const [kind, setKind] = useState("correction");
  const [sign, setSign] = useState<1 | -1>(1);
  const [hours, setHours] = useState("");
  const [days, setDays] = useState("");
  const [date, setDate] = useState(todayIn(user.timezone));
  const [reason, setReason] = useState("");
  const [entitlement, setEntitlement] = useState("");
  const { busy, run, fieldErrors } = useAction();
  function amount(): number {
    if (account === "vacation") return sign * Number(days.replace(",", "."));
    const [h, m] = hours.includes(":") ? hours.split(":").map(Number) : [Number(hours.replace(",", ".")), 0];
    return sign * Math.round(h * 60 + (m || 0));
  }
  async function save(e: Event) {
    e.preventDefault();
    const ok = await run(async () => {
      if (account === "vacation" && entitlement !== "") {
        await api.put(`/accounts/${user.id}/entitlements/${year}`, { days: Number(entitlement.replace(",", ".")), note: reason });
      }
      if ((account === "time" && hours) || (account === "vacation" && days)) {
        await api.post(`/accounts/${user.id}/adjustments`, { account, amount: amount(), kind, effective_date: date, reason });
      }
    }, t("common.saved"));
    if (ok !== undefined) onSaved();
  }
  return (
    <Modal title={t("account.add_adjustment")} onClose={onClose} footer={<>
      <button type="button" class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button type="submit" form="adj-form" class="btn btn-primary" disabled={busy || !reason.trim()}>{t("common.save")}</button>
    </>}>
      <form id="adj-form" class="stack lg" onSubmit={save}>
        {user.id !== me.value?.user.id && <div class="alert small">{t("account.adjust_for", { name: user.name })}</div>}
        <Segmented value={account} onChange={setAccount} options={[{ value: "time", label: t("account.time_account") }, { value: "vacation", label: t("account.vacation") }]} />
        <div class="form-grid">
          <Field label={t("account.kind_label")}>
            <select class="select" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)}>
              {["correction", "opening", "payout"].map((k) => <option key={k} value={k}>{t(`account.kind.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t("account.effective")}><input type="date" class="input" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} /></Field>
          <Field label={account === "time" ? t("account.amount_hours") : t("account.amount_days")} error={fieldErrors.amount}>
            <div class="row" style="gap:6px">
              <div class="segmented"><button type="button" class={sign === 1 ? "active" : ""} onClick={() => setSign(1)}>+</button><button type="button" class={sign === -1 ? "active" : ""} onClick={() => setSign(-1)}>−</button></div>
              {account === "time"
                ? <input class="input" placeholder="2:30" value={hours} onInput={(e) => setHours((e.target as HTMLInputElement).value)} />
                : <input class="input" placeholder="1.5" inputMode="decimal" value={days} onInput={(e) => setDays((e.target as HTMLInputElement).value)} />}
            </div>
          </Field>
          {account === "vacation" && (
            <Field label={t("account.entitlement_override", { year })} help={t("account.entitlement_help")}>
              <input class="input" inputMode="decimal" placeholder={String(user.vacation_days_per_year)} value={entitlement} onInput={(e) => setEntitlement((e.target as HTMLInputElement).value)} />
            </Field>
          )}
          <Field label={t("common.reason")} class="full" help={t("common.reason_required_help")} error={fieldErrors.reason}>
            <input class="input" required value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
