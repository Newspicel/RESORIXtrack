// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Logo } from "../components/icons";
import { ErrorBox, Field, Toasts, useAction } from "../components/ui";
import { api } from "../lib/api";
import { loadBranding } from "../lib/branding";
import { LOCALES, locale, setLocale, t } from "../lib/i18n";
import { browserTimezone } from "../lib/time";

let metaCache: Promise<any> | null = null;
/** Public /meta, fetched once per page load (the sign-in, setup and reset pages all need bits of it). */
export function publicMeta(): Promise<any> {
  if (!metaCache) metaCache = api.get("/meta", undefined, { noRedirect: true }).catch((e) => { metaCache = null; throw e; });
  return metaCache;
}

function AuthFrame({ children }: { children: ComponentChildren }) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  useEffect(() => {
    loadBranding().catch(() => {});
    publicMeta().then((m) => setSourceUrl(m.source_url || null)).catch(() => {});
  }, []);
  return (
    <div class="auth">
      <div class="box">
        <div class="auth-logo"><Logo height={38} /></div>
        <div class="card auth-card">
          <div class="row between" style="margin-bottom:22px">
            <div class="brand-name" style="font-size:1.2rem">RESORIX<b>track</b></div>
            <LangSwitch />
          </div>
          {children}
        </div>
        <p class="tiny muted auth-foot">
          RESORIXtrack · {t("auth.license")}
          {sourceUrl && <> · <a href={sourceUrl} rel="noopener">{t("auth.source_code")}</a></>}
        </p>
      </div>
      <Toasts />
    </div>
  );
}

export function LangSwitch({ onChange }: { onChange?: (code: string) => void }) {
  return (
    <div class="lang-switch" role="group" aria-label={t("profile.language")}>
      {LOCALES.map((l) => (
        <button key={l.code} type="button" class={locale.value === l.code ? "active" : ""}
          onClick={() => { setLocale(l.code); onChange?.(l.code); }}>{l.code.toUpperCase()}</button>
      ))}
    </div>
  );
}

/** Same-origin redirect target after sign-in; anything else (including `/\\evil`, `/%09/evil`) falls back to "/". */
export function safeNext(raw: string | null, origin = location.origin): string {
  if (!raw) return "/";
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin || !u.pathname.startsWith("/")) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

function nextUrl(): string {
  return safeNext(new URLSearchParams(location.search).get("next"));
}

/** Invitation / reset links carry the token in the URL fragment so it never reaches server logs. */
function readToken(): string {
  const hash = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
  const query = new URLSearchParams(location.search).get("token"); // links from older emails
  const token = hash || query || "";
  if (token) history.replaceState(null, "", location.pathname);
  return token;
}

export function LoginView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, run, error } = useAction();
  useEffect(() => {
    api.get("/meta").then((m: any) => {
      if (m.setup_required) location.replace("/setup");
    }).catch(() => {});
    api.get("/me", undefined, { noRedirect: true }).then(() => location.replace(nextUrl())).catch(() => {});
  }, []);
  async function submit(e: Event) {
    e.preventDefault();
    const r = await run(() => api.post<any>("/auth/login", { email, password, remember }, { noRedirect: true }));
    if (!r) return;
    if (r.mfa_required) { setMfaToken(r.mfa_token); setPassword(""); return; }
    location.href = nextUrl();
  }
  async function submitCode(e: Event) {
    e.preventDefault();
    const r = await run(() => api.post("/auth/mfa", { mfa_token: mfaToken, code, remember }, { noRedirect: true }));
    if (r) location.href = nextUrl();
  }
  if (mfaToken) {
    return (
      <AuthFrame>
        <form class="stack lg" onSubmit={submitCode}>
          <div>
            <h2>{t("auth.mfa_title")}</h2>
            <p class="muted">{t("auth.mfa_sub")}</p>
          </div>
          <ErrorBox error={error} />
          <Field label={t("auth.mfa_code")} htmlFor="code" help={t("auth.mfa_recovery_hint")}>
            <input id="code" class="input mono" inputMode="numeric" autocomplete="one-time-code" autofocus required maxLength={20}
              value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
          </Field>
          <button class="btn btn-gradient btn-lg btn-block" disabled={busy || !code}>{t("auth.sign_in")}</button>
          <button type="button" class="btn btn-ghost btn-block" onClick={() => { setMfaToken(null); setCode(""); }}>{t("common.back")}</button>
        </form>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <form class="stack lg" onSubmit={submit}>
        <div>
          <h2>{t("auth.welcome")}</h2>
          <p class="muted">{t("auth.login_sub")}</p>
        </div>
        <ErrorBox error={error} />
        <Field label={t("auth.email")} htmlFor="email">
          <input id="email" class="input" type="email" autocomplete="username" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label={<span class="row between"><span>{t("auth.password")}</span><a href="/forgot" class="small">{t("auth.forgot")}</a></span>} htmlFor="password">
          <input id="password" class="input" type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </Field>
        <label class="checkbox">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember((e.target as HTMLInputElement).checked)} />
          <span>{t("auth.remember")}</span>
        </label>
        <button class="btn btn-gradient btn-lg btn-block" disabled={busy}>{t("auth.sign_in")}</button>
      </form>
    </AuthFrame>
  );
}

export function ForgotView() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [smtp, setSmtp] = useState<boolean | null>(null);
  const { busy, run, error } = useAction();
  useEffect(() => {
    api.get("/meta", undefined, { noRedirect: true }).then((m: any) => setSmtp(!!m.smtp_configured)).catch(() => setSmtp(null));
  }, []);
  return (
    <AuthFrame>
      {smtp === false ? (
        <div class="stack lg">
          <h2>{t("auth.forgot_title")}</h2>
          <p class="muted">{t("auth.no_mail_server")}</p>
          <a class="btn btn-block" href="/login">{t("auth.back_to_login")}</a>
        </div>
      ) : sent ? (
        <div class="stack lg">
          <h2>{t("auth.check_inbox")}</h2>
          <p class="muted">{t("auth.reset_sent", { email })}</p>
          <a class="btn btn-block" href="/login">{t("auth.back_to_login")}</a>
        </div>
      ) : (
        <form class="stack lg" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.post("/auth/forgot", { email }, { noRedirect: true }))) setSent(true); }}>
          <div>
            <h2>{t("auth.forgot_title")}</h2>
            <p class="muted">{t("auth.forgot_sub")}</p>
          </div>
          <ErrorBox error={error} />
          <Field label={t("auth.email")} htmlFor="email">
            <input id="email" class="input" type="email" required autocomplete="username" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
          </Field>
          <button class="btn btn-gradient btn-lg btn-block" disabled={busy}>{t("auth.send_link")}</button>
          <a href="/login" class="small">{t("auth.back_to_login")}</a>
        </form>
      )}
    </AuthFrame>
  );
}

export function PasswordFields({ password, setPassword, confirm, setConfirm, error }: {
  password: string; setPassword: (v: string) => void; confirm: string; setConfirm: (v: string) => void; error?: string;
}) {
  const strong = password.length >= 10;
  return (
    <>
      <Field label={t("auth.new_password")} htmlFor="pw" help={t("auth.password_rules")} error={error}>
        <input id="pw" class="input" type="password" autocomplete="new-password" required minLength={10} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
      </Field>
      <div class="progress" aria-hidden="true"><span style={{ width: `${Math.min(100, (password.length / 16) * 100)}%`, background: strong ? undefined : "var(--color-break)" }} /></div>
      <Field label={t("auth.confirm_password")} htmlFor="pw2" error={confirm && confirm !== password ? t("auth.passwords_differ") : undefined}>
        <input id="pw2" class="input" type="password" autocomplete="new-password" required value={confirm} onInput={(e) => setConfirm((e.target as HTMLInputElement).value)} />
      </Field>
    </>
  );
}

export function TokenPasswordView({ mode }: { mode: "reset" | "invite" }) {
  const [token] = useState(readToken);
  const [info, setInfo] = useState<{ email: string; name: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [lang, setLang] = useState(locale.value);
  const [tz, setTz] = useState(browserTimezone());
  const { busy, run, error, fieldErrors } = useAction();
  useEffect(() => {
    api.post("/auth/token-info", { token }, { noRedirect: true }).then(setInfo).catch(() => setInvalid(true));
  }, []);
  async function submit(e: Event) {
    e.preventDefault();
    if (password !== confirm) return;
    const body: Record<string, unknown> = { token, password };
    if (mode === "invite") Object.assign(body, { locale: lang, timezone: tz });
    const r = await run(() => api.post(mode === "invite" ? "/auth/accept-invite" : "/auth/reset", body, { noRedirect: true }));
    if (r) location.href = "/";
  }
  if (invalid) {
    return (
      <AuthFrame>
        <div class="stack lg">
          <h2>{t("auth.link_invalid")}</h2>
          <p class="muted">{t("auth.link_invalid_sub")}</p>
          <a class="btn btn-primary btn-block" href="/forgot">{t("auth.request_new_link")}</a>
        </div>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <form class="stack lg" onSubmit={submit}>
        <div>
          <h2>{mode === "invite" ? t("auth.invite_title", { name: info?.name?.split(" ")[0] || "" }) : t("auth.reset_title")}</h2>
          <p class="muted">{mode === "invite" ? t("auth.invite_sub") : t("auth.reset_sub")}{info && <> · <strong>{info.email}</strong></>}</p>
        </div>
        <ErrorBox error={error} />
        {mode === "invite" && (
          <div class="form-grid">
            <Field label={t("profile.language")}>
              <select class="select" value={lang} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setLang(v); setLocale(v); }}>
                {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </Field>
            <Field label={t("profile.timezone")}>
              <TimezoneSelect value={tz} onChange={setTz} />
            </Field>
          </div>
        )}
        <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} error={fieldErrors.password} />
        <button class="btn btn-gradient btn-lg btn-block" disabled={busy || !info || password !== confirm}>
          {mode === "invite" ? t("auth.activate") : t("auth.save_password")}
        </button>
      </form>
    </AuthFrame>
  );
}

let tzCache: string[] | null = null;

export function TimezoneSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [zones, setZones] = useState<string[]>(tzCache || [value]);
  useEffect(() => {
    if (tzCache) return;
    api.get<string[]>("/meta/timezones", undefined, { noRedirect: true }).then((z) => { tzCache = z; setZones(z); }).catch(() => {});
  }, []);
  return (
    <select class="select" value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {(zones.includes(value) ? zones : [value, ...zones]).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
    </select>
  );
}

export function SetupView() {
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState("");
  const [tz, setTz] = useState(browserTimezone());
  const [weeklyHours, setWeeklyHours] = useState("42");
  const [vacationDays, setVacationDays] = useState("25");
  const [preset, setPreset] = useState("");
  const [presets, setPresets] = useState<{ key: string; name: string; description: string }[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [start, setStart] = useState(todayIso());
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [meta, setMeta] = useState<{ setup_code_required: boolean; smtp_configured: boolean } | null>(null);
  const { busy, run, error, fieldErrors } = useAction();
  useEffect(() => {
    api.get("/meta", undefined, { noRedirect: true }).then((m: any) => {
      if (!m.setup_required) location.replace("/login");
      setMeta(m);
    });
    api.get("/meta/holiday-presets", undefined, { noRedirect: true }).then((p: any[]) => {
      setPresets(p);
      if (p[0] && !preset) setPreset(p[0].key);
    }).catch(() => {});
  }, []);
  async function finish(e: Event) {
    e.preventDefault();
    if (password !== confirm) return;
    const hours = Number(weeklyHours.replace(",", "."));
    const r = await run(() => api.post("/setup", {
      company_name: company, timezone: tz, locale: locale.value, holiday_preset: preset || null,
      fulltime_weekly_minutes: hours > 0 ? Math.round(hours * 60) : null,
      default_vacation_days: vacationDays !== "" ? Number(vacationDays) : null,
      admin_name: name, admin_email: email, admin_password: password, employment_start: start || null,
      setup_code: meta?.setup_code_required ? code : null,
    }, { noRedirect: true }));
    if (r) location.href = "/";
  }
  const steps = [0, 1, 2];
  return (
    <AuthFrame>
      <div class="steps">{steps.map((i) => <span key={i} class={step >= i ? "on" : ""} />)}</div>
      {step === 0 && (
        <form class="stack lg" onSubmit={(e) => { e.preventDefault(); setStep(1); }}>
          <div><h2>{t("setup.title")}</h2><p class="muted">{t("setup.sub")}</p></div>
          <Field label={t("setup.company")} htmlFor="company"><input id="company" class="input" required maxLength={120} placeholder={t("setup.company_placeholder")} value={company} onInput={(e) => setCompany((e.target as HTMLInputElement).value)} /></Field>
          <Field label={t("profile.timezone")} help={t("setup.timezone_help")}><TimezoneSelect value={tz} onChange={setTz} /></Field>
          <button class="btn btn-gradient btn-lg btn-block">{t("common.next")}</button>
        </form>
      )}
      {step === 1 && (
        <form class="stack lg" onSubmit={(e) => { e.preventDefault(); setStep(2); }}>
          <div><h2>{t("setup.rules_title")}</h2><p class="muted">{t("setup.rules_sub")}</p></div>
          <div class="form-grid">
            <Field label={t("setup.weekly_hours")} help={t("setup.weekly_hours_help")} htmlFor="weekly">
              <input id="weekly" class="input num" type="number" min={1} max={100} step="0.5" required value={weeklyHours} onInput={(e) => setWeeklyHours((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label={t("setup.vacation_days")} help={t("setup.vacation_days_help")} htmlFor="vacdays">
              <input id="vacdays" class="input num" type="number" min={0} max={366} step="0.5" required value={vacationDays} onInput={(e) => setVacationDays((e.target as HTMLInputElement).value)} />
            </Field>
          </div>
          <Field label={t("setup.holidays")} help={t("setup.holidays_help")} htmlFor="preset">
            <select id="preset" class="select" value={preset} onChange={(e) => setPreset((e.target as HTMLSelectElement).value)}>
              {presets.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              <option value="">{t("setup.no_holidays")}</option>
            </select>
          </Field>
          <div class="row">
            <button type="button" class="btn" onClick={() => setStep(0)}>{t("common.back")}</button>
            <button class="btn btn-gradient btn-lg grow">{t("common.next")}</button>
          </div>
        </form>
      )}
      {step === 2 && (
        <form class="stack lg" onSubmit={finish}>
          <div><h2>{t("setup.admin_title")}</h2><p class="muted">{t("setup.admin_sub")}</p></div>
          <ErrorBox error={error} />
          <Field label={t("common.name")} htmlFor="adm-name" error={fieldErrors.admin_name}><input id="adm-name" class="input" required maxLength={120} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
          <Field label={t("auth.email")} htmlFor="adm-email" error={fieldErrors.admin_email}><input id="adm-email" class="input" type="email" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></Field>
          <Field label={t("setup.employment_start")} help={t("setup.employment_start_help")} htmlFor="adm-start" error={fieldErrors.employment_start}>
            <input id="adm-start" class="input" type="date" required value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />
          </Field>
          <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} error={fieldErrors.password} />
          {meta?.setup_code_required && (
            <Field label={t("setup.code")} help={t("setup.code_help")} htmlFor="setup-code" error={fieldErrors.setup_code}>
              <input id="setup-code" class="input mono" required autocomplete="off" spellcheck={false} placeholder="XXXX-XXXX-XXXX" value={code}
                onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())} />
            </Field>
          )}
          {meta && !meta.smtp_configured && <div class="alert warn small">{t("setup.no_smtp")}</div>}
          <div class="row">
            <button type="button" class="btn" onClick={() => setStep(1)}>{t("common.back")}</button>
            <button class="btn btn-gradient btn-lg grow" disabled={busy || password !== confirm}>{t("setup.finish")}</button>
          </div>
        </form>
      )}
    </AuthFrame>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
