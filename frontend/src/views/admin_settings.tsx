// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import "../styles/admin.css";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Confirm, ErrorBox, Field, Loading, Modal, PageHead, Switch, Tabs, useAction, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { LOCALES, absenceLabel, t } from "../lib/i18n";
import { me } from "../lib/store";
import { BrandingTab } from "./admin_branding";
import { DurationInput, safely, val } from "./admin_common";
import { TimezoneSelect } from "./auth";

type Tab = "general" | "branding" | "rules" | "types" | "email";

export function AdminSettingsPage() {
  return (
    <Shell active="settings" adminOnly title={t("admin.settings.title")}>
      <SettingsView />
    </Shell>
  );
}

function SettingsView() {
  const [tab, setTab] = useState<Tab>("general");
  return (
    <div>
      <PageHead title={t("admin.settings.title")} sub={t("admin.settings.sub")} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "general", label: t("admin.settings.tab_general") },
        { value: "branding", label: t("admin.settings.tab_branding") },
        { value: "rules", label: t("admin.settings.tab_rules") },
        { value: "types", label: t("admin.settings.tab_types") },
        { value: "email", label: t("admin.settings.tab_email") },
      ]} />
      {(tab === "general" || tab === "rules") && <SettingsForm key={tab} section={tab} />}
      {tab === "branding" && <BrandingTab />}
      {tab === "types" && <AbsenceTypes />}
      {tab === "email" && <Email />}
    </div>
  );
}

function Section({ title, help, children }: { title: string; help?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="settings-section">
      <div><h3>{title}</h3>{help && <p class="small muted">{help}</p>}</div>
      <div class="stack">{children}</div>
    </div>
  );
}

function SettingsForm({ section }: { section: "general" | "rules" }) {
  const { data, loading, error, setData } = useAsync(() => api.get<Record<string, any>>("/admin/settings"), []);
  const [f, setF] = useState<Record<string, any> | null>(null);
  const { busy, run, fieldErrors } = useAction();
  useEffect(() => { if (data) setF({ ...data }); }, [data]);
  if (loading || !f) return error ? <ErrorBox error={error} /> : <Loading />;
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const changed = Object.keys(f).filter((k) => k !== "setup_complete" && JSON.stringify(f[k]) !== JSON.stringify(data![k]));
  async function save(e: Event) {
    e.preventDefault();
    const body = Object.fromEntries(changed.map((k) => [k, f![k]]));
    const r = await run(() => api.patch<Record<string, any>>("/admin/settings", body), t("common.saved"));
    if (r) setData(r);
  }
  const num = (k: string, props: Record<string, unknown> = {}) => (
    <input class="input num" type="number" value={f[k]} {...props} onInput={(e) => set(k, Number(val(e)))} aria-invalid={fieldErrors[k] ? "true" : undefined} />
  );
  return (
    <form class="card" onSubmit={save}>
      {section === "general" && <>
        <Section title={t("admin.settings.defaults")} help={t("admin.settings.defaults_help")}>
          <div class="form-grid">
            <Field label={t("admin.users.timezone")}><TimezoneSelect value={f.default_timezone} onChange={(v) => set("default_timezone", v)} /></Field>
            <Field label={t("admin.users.language")}>
              <select class="select" value={f.default_locale} onChange={(e) => set("default_locale", val(e))}>
                {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </Field>
          </div>
        </Section>
        <Section title={t("admin.settings.sessions")} help={t("admin.settings.sessions_help")}>
          <div class="form-grid">
            <Field label={t("admin.settings.session_remember_days")} error={fieldErrors.session_remember_days}>{num("session_remember_days", { min: 1, max: 365 })}</Field>
            {"login_log_retention_days" in f && (
              <Field label={t("admin.settings.login_log_retention")} help={t("admin.settings.login_log_retention_help")} error={fieldErrors.login_log_retention_days}>
                {num("login_log_retention_days", { min: 30, max: 3650 })}
              </Field>
            )}
          </div>
        </Section>
        {"api_tokens_enabled" in f && (
          <Section title={t("admin.settings.api_tokens")} help={t("admin.settings.api_tokens_help")}>
            <Switch checked={f.api_tokens_enabled} onChange={(v) => set("api_tokens_enabled", v)} label={t("admin.settings.api_tokens_enabled")} />
          </Section>
        )}
        {"mfa_required_for_admins" in f && (
          <Section title={t("admin.settings.mfa")} help={t("admin.settings.mfa_help")}>
            <Switch checked={f.mfa_required_for_admins} onChange={(v) => set("mfa_required_for_admins", v)} label={t("admin.settings.mfa_required")} />
            <Switch checked={!!f.mfa_required_for_all} onChange={(v) => set("mfa_required_for_all", v)} label={t("admin.settings.mfa_required_all")} />
          </Section>
        )}
        <Section title={t("admin.settings.permissions")} help={t("admin.settings.permissions_help")}>
          <Switch checked={f.lead_can_edit_schedules} onChange={(v) => set("lead_can_edit_schedules", v)} label={t("admin.settings.lead_can_edit_schedules")} />
          <Switch checked={f.lead_can_adjust_balances} onChange={(v) => set("lead_can_adjust_balances", v)} label={t("admin.settings.lead_can_adjust_balances")} />
        </Section>
      </>}
      {section === "rules" && <>
        <div class="alert warn small" style="margin-bottom:16px">{t("admin.settings.rules_warning")}</div>
        <Section title={t("admin.settings.holiday_mode")} help={t("admin.settings.holiday_mode_help")}>
          {(["scheduled", "prorata"] as const).map((m) => (
            <label key={m} class={`mode-option ${f.holiday_mode === m ? "active" : ""}`}>
              <input type="radio" name="holiday_mode" checked={f.holiday_mode === m} onChange={() => set("holiday_mode", m)} />
              <div><strong>{t(`admin.settings.mode_${m}`)}</strong><div class="small muted">{t(`admin.settings.mode_${m}_help`)}</div></div>
            </label>
          ))}
          <div class="form-grid">
            <Field label={t("admin.settings.fulltime_weekly")} help={t("admin.settings.fulltime_weekly_help")} error={fieldErrors.fulltime_weekly_minutes}>
              <DurationInput value={f.fulltime_weekly_minutes} onChange={(v) => set("fulltime_weekly_minutes", v)} />
            </Field>
            <Field label={t("admin.settings.surcharge")} help={t("admin.settings.surcharge_help")} error={fieldErrors.holiday_work_surcharge_percent}>
              {num("holiday_work_surcharge_percent", { min: 0, max: 200, step: 5 })}
            </Field>
            {"default_vacation_days" in f && (
              <Field label={t("admin.settings.default_vacation_days")} error={fieldErrors.default_vacation_days}>
                {num("default_vacation_days", { min: 0, max: 366, step: 0.5 })}
              </Field>
            )}
          </div>
          {"vacation_prorate_workdays" in f && (
            <Switch checked={f.vacation_prorate_workdays} onChange={(v) => set("vacation_prorate_workdays", v)} label={t("admin.settings.vacation_prorate")} />
          )}
          {"vacation_prorate_workdays" in f && <p class="small muted" style="margin-top:-6px">{t("admin.settings.vacation_prorate_help")}</p>}
        </Section>
        {"worklog_mode" in f && (
          <Section title={t("admin.settings.worklog")} help={t("admin.settings.worklog_help")}>
            {(["off", "optional", "required"] as const).map((m) => (
              <label key={m} class={`mode-option ${f.worklog_mode === m ? "active" : ""}`}>
                <input type="radio" name="worklog_mode" checked={f.worklog_mode === m} onChange={() => set("worklog_mode", m)} />
                <div><strong>{t(`admin.settings.worklog_${m}`)}</strong></div>
              </label>
            ))}
            {f.worklog_mode === "required" && (
              <Field label={t("admin.settings.worklog_percent")} help={t("admin.settings.worklog_percent_help")} error={fieldErrors.worklog_required_percent}>
                {num("worklog_required_percent", { min: 1, max: 100 })}
              </Field>
            )}
            {f.worklog_mode !== "off" && (
              <Switch checked={f.worklog_project_required} onChange={(v) => set("worklog_project_required", v)} label={t("admin.settings.worklog_project_required")} />
            )}
          </Section>
        )}
        <Section title={t("admin.settings.law")} help={t("admin.settings.law_help")}>
          <Switch checked={f.break_rules_enabled} onChange={(v) => set("break_rules_enabled", v)} label={t("admin.settings.break_rules")} />
          <Field label={t("admin.settings.weekly_max")} help={t("admin.settings.weekly_max_help")} error={fieldErrors.weekly_max_minutes}>
            <DurationInput value={f.weekly_max_minutes} onChange={(v) => set("weekly_max_minutes", v)} />
          </Field>
        </Section>
        <Section title={t("admin.settings.edits")} help={t("admin.settings.edits_help")}>
          <Switch checked={f.reason_required_for_past_edits} onChange={(v) => set("reason_required_for_past_edits", v)} label={t("admin.settings.reason_required")} />
          <Field label={t("admin.settings.clock_reminder")} help={t("admin.settings.clock_reminder_help")} error={fieldErrors.clock_reminder_hours}>
            {num("clock_reminder_hours", { min: 0, max: 24 })}
          </Field>
        </Section>
        <Section title={t("admin.settings.sick")} help={t("admin.settings.sick_help")}>
          <div class="form-grid">
            <Field label={t("admin.settings.sick_backdate")} error={fieldErrors.sick_self_report_backdate_days}>{num("sick_self_report_backdate_days", { min: 0, max: 60 })}</Field>
            <Field label={t("admin.settings.sick_max")} error={fieldErrors.sick_self_report_max_days}>{num("sick_self_report_max_days", { min: 1, max: 365 })}</Field>
          </div>
        </Section>
      </>}
      <div class="row end" style="padding-top:14px">
        {changed.length > 0 && <span class="small muted">{t("admin.settings.unsaved", { count: changed.length })}</span>}
        <button class="btn btn-primary" disabled={busy || changed.length === 0}>{t("common.save")}</button>
      </div>
    </form>
  );
}

interface AbsenceType {
  id: number; key: string; label: string; color: string; category: string; credits_time: boolean; deducts_vacation: boolean;
  requires_approval: boolean; allows_attachments: boolean; employee_can_request: boolean; is_active: boolean; sort: number;
}

const FLAGS = ["requires_approval", "employee_can_request", "allows_attachments", "credits_time", "deducts_vacation"] as const;

function AbsenceTypes() {
  const { data, loading, error, reload, setData } = useAsync(() => api.get<AbsenceType[]>("/absence-types"), []);
  const [edit, setEdit] = useState<AbsenceType | "new" | null>(null);
  const [pending, setPending] = useState<{ tp: AbsenceType; key: string; value: boolean } | null>(null);
  async function apply(tp: AbsenceType, key: string, value: boolean) {
    setData((data || []).map((x) => (x.id === tp.id ? { ...x, [key]: value } : x)));
    if (!(await safely(() => api.patch(`/absence-types/${tp.id}`, { [key]: value }), t("common.saved")))) reload();
  }
  function toggle(tp: AbsenceType, key: string, value: boolean) {
    // credits_time / deducts_vacation change how past months are calculated: ask first.
    if (key === "credits_time" || key === "deducts_vacation") setPending({ tp, key, value });
    else apply(tp, key, value);
  }
  return (
    <div class="card">
      <div class="card-head">
        <div><h2>{t("admin.types.title")}</h2><p class="card-sub">{t("admin.types.sub")}</p></div>
        <button class="btn btn-primary btn-sm" onClick={() => setEdit("new")}><Icon.plus />{t("admin.types.new")}</button>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th>{t("common.type")}</th><th>{t("admin.types.category")}</th>
              {FLAGS.map((k) => <th key={k} style="text-align:center">{t(`admin.types.${k}`)}</th>)}
              <th style="text-align:center">{t("common.active")}</th><th />
            </tr></thead>
            <tbody>
              {(data || []).map((tp) => (
                <tr key={tp.id} style={tp.is_active ? "" : "opacity:.55"}>
                  <td><span class="row" style="gap:8px"><span class="dot" style={{ background: tp.color }} /><strong>{absenceLabel(tp)}</strong><code class="tiny faint">{tp.key}</code></span></td>
                  <td><span class="badge">{t(`admin.types.cat_${tp.category}`)}</span></td>
                  {FLAGS.map((k) => (
                    <td key={k} style="text-align:center">
                      <input type="checkbox" style="accent-color:var(--color-brand);width:16px;height:16px" checked={tp[k]}
                        aria-label={`${absenceLabel(tp)}: ${t(`admin.types.${k}`)}`} onChange={(e) => toggle(tp, k, (e.target as HTMLInputElement).checked)} />
                    </td>
                  ))}
                  <td style="text-align:center"><Switch checked={tp.is_active} onChange={(v) => toggle(tp, "is_active", v)} /></td>
                  <td class="n"><button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.edit")} onClick={() => setEdit(tp)}><Icon.edit /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p class="tiny muted" style="margin-top:12px">{t("admin.types.legend")}</p>
      {edit && <TypeModal type={edit === "new" ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {pending && <Confirm title={`${absenceLabel(pending.tp)}: ${t(`admin.types.${pending.key}`)}`} message={t("admin.types.flag_warning")}
        onClose={() => setPending(null)} onConfirm={() => apply(pending.tp, pending.key, pending.value)} />}
    </div>
  );
}

function slugify(label: string): string {
  const base = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  return /^[a-z]/.test(base) ? base : `t_${base}`.slice(0, 32);
}

function TypeModal({ type, onClose, onDone }: { type: AbsenceType | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Partial<AbsenceType>>(type ? { ...type } : {
    key: "", label: "", color: "#8f7ad1", category: "other", credits_time: true, deducts_vacation: false,
    requires_approval: true, allows_attachments: false, employee_can_request: true, is_active: true, sort: 200,
  });
  const { busy, run, fieldErrors, error } = useAction();
  const set = (patch: Partial<AbsenceType>) => setF({ ...f, ...patch });
  async function save(e: Event) {
    e.preventDefault();
    const { id: _id, ...body } = f as AbsenceType;
    const r = await run(() => (type ? api.patch(`/absence-types/${type.id}`, body) : api.post("/absence-types", body)), t("common.saved"));
    if (r) onDone();
  }
  return (
    <Modal title={type ? t("admin.types.edit") : t("admin.types.new")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-primary" form="type-form" disabled={busy}>{t("common.save")}</button>
    </>}>
      <form id="type-form" class="stack" onSubmit={save}>
        <ErrorBox error={error} />
        <div class="form-grid">
          <Field label={t("admin.types.label")} error={fieldErrors.label} help={type && t("admin.types.label_help")}>
            <input class="input" required value={f.label} onInput={(e) => set(type ? { label: val(e) } : { label: val(e), key: slugify(val(e)) })} />
          </Field>
          <Field label={t("admin.types.key")} help={t("admin.types.key_help")} error={fieldErrors.key}>
            <input class="input mono" required disabled={!!type} pattern="[a-z][a-z0-9_]{1,31}" value={f.key} onInput={(e) => set({ key: val(e) })} />
          </Field>
          <Field label={t("admin.types.category")}>
            <select class="select" value={f.category} disabled={!!type} onChange={(e) => set({ category: val(e) })}>
              {["vacation", "sick", "other"].map((c) => <option key={c} value={c}>{t(`admin.types.cat_${c}`)}</option>)}
            </select>
          </Field>
          <Field label={t("admin.teams.color")}><input class="color-input" type="color" value={f.color} onInput={(e) => set({ color: val(e) })} /></Field>
        </div>
        {FLAGS.map((k) => <Switch key={k} checked={!!f[k]} onChange={(v) => set({ [k]: v })} label={t(`admin.types.${k}_long`)} />)}
      </form>
    </Modal>
  );
}

function Email() {
  const { data, loading, error } = useAsync(() => api.get<any>("/admin/smtp"), []);
  const [to, setTo] = useState(me.value?.user.email || "");
  const { busy, run, error: sendError } = useAction();
  return (
    <div class="card">
      <div class="card-head"><div><h2>{t("admin.email.title")}</h2><p class="card-sub">{t("admin.email.sub")}</p></div>
        {data && (data.configured ? <span class="badge ok">{t("admin.email.configured")}</span> : <span class="badge warn">{t("admin.email.not_configured")}</span>)}</div>
      <ErrorBox error={error} />
      {loading ? <Loading /> : data && (
        <div class="stack lg">
          <div class="table-wrap">
            <table class="table">
              <tbody>
                <tr><td class="muted">{t("admin.email.host")}</td><td class="mono">{data.host || "–"}</td></tr>
                <tr><td class="muted">{t("admin.email.port")}</td><td class="mono">{data.port}</td></tr>
                <tr><td class="muted">{t("admin.email.security")}</td><td class="mono">{data.security}</td></tr>
                <tr><td class="muted">{t("admin.email.user")}</td><td class="mono">{data.user || "–"}</td></tr>
                <tr><td class="muted">{t("admin.email.from")}</td><td class="mono">{data.from}</td></tr>
              </tbody>
            </table>
          </div>
          <p class="small muted">{t("admin.email.env_help")}</p>
          <ErrorBox error={sendError} />
          <form class="row wrap" onSubmit={async (e) => { e.preventDefault(); await run(() => api.post("/admin/smtp/test", { to }), t("admin.email.sent", { to })); }}>
            <input class="input" type="email" required value={to} onInput={(e) => setTo(val(e))} style="max-width:320px" aria-label={t("common.email")} />
            <button class="btn btn-primary" disabled={busy}><Icon.mail />{t("admin.email.send_test")}</button>
          </form>
        </div>
      )}
    </div>
  );
}
