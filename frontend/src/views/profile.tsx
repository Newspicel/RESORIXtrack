// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Confirm, Field, Loading, Modal, PageHead, Switch, useAction, useAsync } from "../components/ui";
import { api, download } from "../lib/api";
import { LOCALES, setLocale, t } from "../lib/i18n";
import { loadMe, me, toast } from "../lib/store";
import { browserTimezone, fmtDate, fmtDateTime, fmtDuration, relativeTime } from "../lib/time";
import { PasswordFields, TimezoneSelect } from "./auth";

export function ProfilePage() {
  return (
    <Shell active="profile" title={t("nav.profile")}>
      <PageHead title={t("profile.title")} sub={me.value?.user.email} />
      <div class="grid cols-2" style="align-items:start">
        <div class="stack lg">
          <PersonalCard />
          <PasswordCard />
        </div>
        <div class="stack lg">
          <div id="mfa" style="scroll-margin-top:80px"><TwoFactorCard /></div>
          {me.value?.api_tokens_enabled !== false && <div id="tokens" style="scroll-margin-top:80px"><TokensCard /></div>}
          <SessionsCard />
          <LoginHistoryCard />
        </div>
      </div>
    </Shell>
  );
}

function PersonalCard() {
  const u = me.value!.user;
  const [name, setName] = useState(u.name);
  const [locale, setLoc] = useState(u.locale);
  const [tz, setTz] = useState(u.timezone);
  const [notify, setNotify] = useState(!!u.notify_email_on_correction);
  const { busy, run } = useAction();
  const browserTz = browserTimezone();
  async function save(e: Event) {
    e.preventDefault();
    const ok = await run(() => api.patch("/me", { name, locale, timezone: tz, notify_email_on_correction: notify }), t("common.saved"));
    if (ok !== undefined) { setLocale(locale); await loadMe(); }
  }
  return (
    <form class="card stack lg" onSubmit={save}>
      <div class="card-head" style="margin:0"><h2><Icon.user width={18} />{t("profile.personal")}</h2></div>
      <Field label={t("common.name")}><input class="input" required value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
      <div class="form-grid">
        <Field label={t("profile.language")}>
          <select class="select" value={locale} onChange={(e) => setLoc((e.target as HTMLSelectElement).value)}>
            {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </Field>
        <Field label={t("profile.timezone")} help={browserTz !== tz ? <button type="button" class="btn btn-ghost btn-sm" style="padding:0;height:auto" onClick={() => setTz(browserTz)}>{t("profile.use_device_tz", { tz: browserTz })}</button> : t("profile.tz_help")}>
          <TimezoneSelect value={tz} onChange={setTz} />
        </Field>
      </div>
      <Switch checked={notify} onChange={setNotify} label={t("profile.notify_corrections")} />
      <div class="small muted">
        {u.team_name && <div>{t("common.team")}: {u.team_name}</div>}
        {u.employment_start && <div>{t("profile.employed_since", { date: fmtDate(u.employment_start) })}</div>}
        {u.schedules && u.schedules.length > 0 && <div>{t("profile.schedule", { pensum: u.schedules[u.schedules.length - 1].pensum_percent, hours: fmtDuration(u.schedules[u.schedules.length - 1].weekly_minutes) })}</div>}
      </div>
      <div class="row between wrap">
        <button type="button" class="btn btn-ghost btn-sm" onClick={() => download("/me/export", undefined, "resorixtrack-my-data.json")}><Icon.download />{t("profile.export_data")}</button>
        <button class="btn btn-primary" disabled={busy}>{t("common.save")}</button>
      </div>
    </form>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, run, fieldErrors } = useAction();
  async function save(e: Event) {
    e.preventDefault();
    const ok = await run(() => api.post("/auth/change-password", { current_password: current, new_password: password }), t("profile.password_changed"));
    if (ok !== undefined) { setCurrent(""); setPassword(""); setConfirm(""); }
  }
  return (
    <form class="card stack lg" onSubmit={save}>
      <div class="card-head" style="margin:0"><h2><Icon.lock width={18} />{t("profile.password")}</h2></div>
      <Field label={t("profile.current_password")} error={fieldErrors.current_password}>
        <input class="input" type="password" autocomplete="current-password" required value={current} onInput={(e) => setCurrent((e.target as HTMLInputElement).value)} />
      </Field>
      <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} error={fieldErrors.password} />
      <div class="small muted">{t("profile.password_help")}</div>
      <div class="row end"><button class="btn btn-primary" disabled={busy || !password || password !== confirm}>{t("profile.change_password")}</button></div>
    </form>
  );
}

function TwoFactorCard() {
  const { data, loading, reload } = useAsync(() => api.get<any>("/auth/mfa"), []);
  const [flow, setFlow] = useState<null | "enable" | "disable" | "codes">(null);
  if (loading && !data) return <div class="card"><Loading /></div>;
  const st = data || { enabled: false };
  return (
    <div class="card stack">
      <div class="card-head" style="margin:0">
        <h2><Icon.shield width={18} />{t("profile.mfa.title")}</h2>
        {st.enabled ? <span class="badge ok">{t("profile.mfa.on")}</span> : <span class="badge warn">{t("profile.mfa.off")}</span>}
      </div>
      <p class="small muted">{t("profile.mfa.help")}</p>
      {st.required && !st.enabled && <div class="alert warn small">{t("profile.mfa.required")}</div>}
      {st.enabled ? (
        <div class="stack sm">
          <div class="small">{t("profile.mfa.since", { date: fmtDateTime(st.enabled_at, tz) })} · {t("profile.mfa.codes_left", { count: st.recovery_codes_left })}</div>
          <div class="row wrap">
            <button class="btn btn-sm" onClick={() => setFlow("codes")}><Icon.refresh />{t("profile.mfa.new_codes")}</button>
            <button class="btn btn-sm btn-danger" onClick={() => setFlow("disable")}>{t("profile.mfa.disable")}</button>
          </div>
        </div>
      ) : (
        <div><button class="btn btn-primary" onClick={() => setFlow("enable")}><Icon.shield />{t("profile.mfa.enable")}</button></div>
      )}
      {flow === "enable" && <EnableMfaModal onClose={() => { setFlow(null); reload(); loadMe(); }} />}
      {flow && flow !== "enable" && <MfaCodeModal mode={flow} onClose={() => { setFlow(null); reload(); loadMe(); }} />}
    </div>
  );
}

function EnableMfaModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string; qr_svg: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const { busy, run, fieldErrors, error } = useAction();
  return (
    <Modal title={t("profile.mfa.enable")} onClose={onClose} footer={step === 2
      ? <button class="btn btn-primary" onClick={onClose}>{t("profile.mfa.saved_codes")}</button>
      : <>
        <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
        <button class="btn btn-primary" form="mfa-form" disabled={busy || (step === 0 ? !password : !code)}>{step === 0 ? t("common.next") : t("profile.mfa.activate")}</button>
      </>}>
      <form id="mfa-form" class="stack lg" onSubmit={async (e) => {
        e.preventDefault();
        if (step === 0) {
          const r = await run(() => api.post<any>("/auth/mfa/setup", { current_password: password }));
          if (r) { setSetup(r); setStep(1); }
        } else if (step === 1) {
          const r = await run(() => api.post<any>("/auth/mfa/confirm", { code }));
          if (r) { setCodes(r.recovery_codes); setStep(2); }
        }
      }}>
        <ErrorBox error={error} />
        {step === 0 && <>
          <p class="muted small">{t("profile.mfa.step_password")}</p>
          <Field label={t("profile.current_password")} error={fieldErrors.current_password}>
            <input class="input" type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
          </Field>
        </>}
        {step === 1 && setup && <>
          <p class="muted small">{t("profile.mfa.step_scan")}</p>
          <div class="row" style="align-items:flex-start;gap:18px;flex-wrap:wrap">
            <img alt="QR code" width={176} height={176} style="background:#fff;border-radius:8px;padding:6px" src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qr_svg)}`} />
            <div class="stack sm grow">
              <div class="small muted">{t("profile.mfa.manual_key")}</div>
              <code class="mono small" style="word-break:break-all">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
              <Field label={t("profile.mfa.code_from_app")} error={fieldErrors.code}>
                <input class="input mono" inputMode="numeric" autocomplete="one-time-code" required maxLength={6} value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
              </Field>
            </div>
          </div>
        </>}
        {step === 2 && <>
          <div class="alert warn small">{t("profile.mfa.codes_help")}</div>
          <pre class="mono small" style="background:var(--color-surface-2);padding:12px;border-radius:8px;margin:0;columns:2">{codes.join("\n")}</pre>
          <button type="button" class="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(codes.join("\n")); toast(t("common.copied")); }}>{t("common.copy")}</button>
        </>}
      </form>
    </Modal>
  );
}

function MfaCodeModal({ mode, onClose }: { mode: "disable" | "codes"; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const { busy, run, fieldErrors, error } = useAction();
  const title = mode === "disable" ? t("profile.mfa.disable") : t("profile.mfa.new_codes");
  return (
    <Modal title={title} onClose={onClose} footer={codes
      ? <button class="btn btn-primary" onClick={onClose}>{t("profile.mfa.saved_codes")}</button>
      : <>
        <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
        <button class={`btn ${mode === "disable" ? "btn-danger" : "btn-primary"}`} form="mfa-code-form" disabled={busy || !password || !code}>{title}</button>
      </>}>
      {codes ? (
        <div class="stack">
          <div class="alert warn small">{t("profile.mfa.codes_help")}</div>
          <pre class="mono small" style="background:var(--color-surface-2);padding:12px;border-radius:8px;margin:0;columns:2">{codes.join("\n")}</pre>
        </div>
      ) : (
        <form id="mfa-code-form" class="stack" onSubmit={async (e) => {
          e.preventDefault();
          if (mode === "disable") {
            if (await run(() => api.post("/auth/mfa/disable", { current_password: password, code }), t("profile.mfa.disabled"))) onClose();
          } else {
            const r = await run(() => api.post<any>("/auth/mfa/recovery-codes", { current_password: password, code }));
            if (r) setCodes(r.recovery_codes);
          }
        }}>
          <ErrorBox error={error} />
          {mode === "disable" && <p class="muted small">{t("profile.mfa.disable_help")}</p>}
          <Field label={t("profile.current_password")} error={fieldErrors.current_password}>
            <input class="input" type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label={t("profile.mfa.code_or_recovery")} error={fieldErrors.code}>
            <input class="input mono" autocomplete="one-time-code" required value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
          </Field>
        </form>
      )}
    </Modal>
  );
}

function SessionsCard() {
  const { data, loading, reload } = useAsync(() => api.get<any[]>("/auth/sessions"), []);
  const [confirmAll, setConfirmAll] = useState(false);
  const tz = me.value!.user.timezone;
  return (
    <div class="card">
      <div class="card-head">
        <h2><Icon.monitor width={18} />{t("profile.sessions")}</h2>
        {data && data.length > 1 && <button class="btn btn-sm btn-danger" onClick={() => setConfirmAll(true)}>{t("profile.sign_out_others")}</button>}
      </div>
      <p class="small muted" style="margin-bottom:12px">{t("profile.sessions_help", { days: me.value?.session_remember_days ?? 30 })}</p>
      {loading ? <Loading /> : (
        <div class="stack">
          {(data || []).map((s) => (
            <div key={s.id} class="row">
              <Icon.monitor width={20} style="color:var(--color-muted)" />
              <div class="grow">
                <div style="font-weight:560">{s.device} {s.current && <span class="badge brand">{t("profile.this_device")}</span>}</div>
                <div class="tiny muted">{t("profile.last_active", { when: relativeTime(s.last_seen_at) })} · {s.ip} · {s.remember ? t("profile.until", { date: fmtDateTime(s.expires_at, tz) }) : t("profile.browser_session")}</div>
              </div>
              {!s.current && <button class="btn btn-ghost btn-sm" onClick={async () => { await api.del(`/auth/sessions/${s.id}`); toast(t("profile.signed_out")); reload(); }}>{t("profile.sign_out")}</button>}
            </div>
          ))}
        </div>
      )}
      {confirmAll && <Confirm title={t("profile.sign_out_others")} message={t("profile.sign_out_others_help")} danger
        onClose={() => setConfirmAll(false)} onConfirm={async () => { await api.post("/auth/sessions/revoke-others", {}); toast(t("profile.signed_out")); reload(); }} />}
    </div>
  );
}

function LoginHistoryCard() {
  const { data, loading } = useAsync(() => api.get<any[]>("/auth/login-history"), []);
  const tz = me.value!.user.timezone;
  const [all, setAll] = useState(false);
  const items = (data || []).slice(0, all ? 50 : 6);
  const failed = (data || []).filter((x) => !x.success).length;
  return (
    <div class="card">
      <div class="card-head">
        <h2><Icon.shield width={18} />{t("profile.login_history")}</h2>
        {failed > 0 && <span class="badge danger">{t("profile.failed_attempts", { count: failed })}</span>}
      </div>
      <p class="small muted" style="margin-bottom:12px">{t("profile.login_history_help")}</p>
      {loading ? <Loading /> : (
        <div class="stack sm">
          {items.map((a) => (
            <div key={a.id} class="row small">
              <span class={`badge ${a.success ? "ok" : "danger"}`}>{a.success ? t("profile.login_ok") : t("profile.login_failed")}</span>
              <span class="grow">{t(`profile.login_reason.${a.reason || (a.success ? "ok" : "invalid_password")}`)} · {a.device}</span>
              <span class="muted nowrap">{fmtDateTime(a.at, tz)} · {a.ip}</span>
            </div>
          ))}
          {(data || []).length > 6 && <button class="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>{all ? t("profile.show_less") : t("profile.show_all")}</button>}
        </div>
      )}
    </div>
  );
}

const SCOPE_OPTIONS = ["clock", "entries:read", "entries:write", "absences:read", "absences:write", "reports:read"];

function TokensCard() {
  const { data, loading, reload } = useAsync(() => api.get<any[]>("/tokens"), []);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<any>(null);
  return (
    <div class="card">
      <div class="card-head">
        <h2><Icon.key width={18} />{t("profile.tokens")}</h2>
        <button class="btn btn-sm" onClick={() => setCreating(true)}><Icon.plus />{t("profile.new_token")}</button>
      </div>
      <p class="small muted" style="margin-bottom:12px">{t("profile.tokens_help")} <a href="/api/docs" target="_blank" rel="noopener">{t("profile.api_docs")}</a></p>
      {loading ? <Loading /> : (data || []).length === 0 ? <div class="small muted">{t("profile.no_tokens")}</div> : (
        <div class="stack">
          {(data || []).map((tok) => (
            <div key={tok.id} class="row">
              <div class="grow">
                <div style="font-weight:560">{tok.name} <span class="mono tiny faint">{tok.prefix}…</span></div>
                <div class="tiny muted">{tok.scopes.join(", ")} · {tok.last_used_at ? t("profile.last_used", { when: relativeTime(tok.last_used_at) }) + (tok.last_used_ip ? ` (${tok.last_used_ip})` : "") : t("profile.never_used")} · {t("profile.uses", { count: tok.use_count || 0 })}{tok.expires_at && ` · ${t("profile.expires", { date: fmtDate(tok.expires_at.slice(0, 10)) })}`}</div>
              </div>
              <button class="btn btn-ghost btn-sm" onClick={() => setRevoke(tok)}>{t("profile.revoke")}</button>
            </div>
          ))}
        </div>
      )}
      {creating && <TokenModal onClose={() => setCreating(false)} onCreated={(tk) => { setCreating(false); setCreated(tk); reload(); }} />}
      {created && (
        <Modal title={t("profile.token_created")} onClose={() => setCreated(null)} footer={<button class="btn btn-primary" onClick={() => setCreated(null)}>{t("common.close")}</button>}>
          <div class="stack">
            <div class="alert warn small">{t("profile.token_once")}</div>
            <div class="row"><input class="input mono" readOnly value={created} onFocus={(e) => (e.target as HTMLInputElement).select()} />
              <button class="btn" onClick={() => { navigator.clipboard?.writeText(created); toast(t("common.copied")); }}>{t("common.copy")}</button></div>
            <pre class="small mono" style="white-space:pre-wrap;background:var(--color-surface-2);padding:10px;border-radius:8px;margin:0">{`curl -X POST -H "Authorization: Bearer ${created.slice(0, 10)}…" ${location.origin}/api/v1/clock/start`}</pre>
          </div>
        </Modal>
      )}
      {revoke && <Confirm title={t("profile.revoke_title", { name: revoke.name })} danger confirmLabel={t("profile.revoke")}
        onClose={() => setRevoke(null)} onConfirm={async () => { await api.del(`/tokens/${revoke.id}`); reload(); }} />}
    </div>
  );
}

function TokenModal({ onClose, onCreated }: { onClose: () => void; onCreated: (token: string) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["clock", "entries:read"]);
  const [expires, setExpires] = useState("90");
  const [password, setPassword] = useState("");
  const { busy, run, fieldErrors } = useAction();
  return (
    <Modal title={t("profile.new_token")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-primary" disabled={busy || !name.trim() || scopes.length === 0 || !password} onClick={async () => {
        const r = await run(() => api.post<any>("/tokens", { name, scopes, expires_in_days: Number(expires), current_password: password }));
        if (r) onCreated(r.token);
      }}>{t("common.create")}</button>
    </>}>
      <div class="stack lg">
        <Field label={t("common.name")} help={t("profile.token_name_help")}><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
        <Field label={t("profile.scopes")}>
          <div class="stack sm">
            {SCOPE_OPTIONS.map((s) => (
              <label key={s} class="checkbox"><input type="checkbox" checked={scopes.includes(s)}
                onChange={(e) => setScopes((e.target as HTMLInputElement).checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
                <span><span class="mono small">{s}</span> <span class="small muted">{t(`profile.scope.${s.replace(":", "_")}`)}</span></span></label>
            ))}
          </div>
        </Field>
        <Field label={t("profile.expiry")}>
          <select class="select" value={expires} onChange={(e) => setExpires((e.target as HTMLSelectElement).value)}>
            <option value="30">30 {t("common.days")}</option><option value="90">90 {t("common.days")}</option>
            <option value="365">365 {t("common.days")}</option>
          </select>
        </Field>
        <Field label={t("profile.token_password")} help={t("profile.token_password_help")} error={fieldErrors.current_password}>
          <input class="input" type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </Field>
      </div>
    </Modal>
  );
}
