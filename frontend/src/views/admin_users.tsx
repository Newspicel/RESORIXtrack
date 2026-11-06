// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import "../styles/admin.css";
import { useMemo, useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Avatar, Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHead, PasswordConfirmModal, Switch, Tabs, useAction, useAsync } from "../components/ui";
import { api, download } from "../lib/api";
import { LOCALES, t } from "../lib/i18n";
import { me, toast } from "../lib/store";
import type { Schedule, User } from "../lib/store";
import { fmtDate, fmtDays, fmtDuration, relativeTime, todayIn } from "../lib/time";
import {
  DurationInput, ScheduleEditor, type WeekMinutes, WEEKDAY_KEYS, safely, scheduleFromPensum, val, weeklyTotal,
} from "./admin_common";
import { SchedulePanel, TeamSelect } from "../components/schedule_panel";
import { TimezoneSelect } from "./auth";

interface Team { id: number; name: string; color: string }
interface Calendar { id: number; name: string; is_default: boolean }

export function AdminUsersPage() {
  return (
    <Shell active="users" adminOnly title={t("admin.users.title")}>
      <Users />
    </Shell>
  );
}

function useRefs() {
  const teams = useAsync(() => api.get<Team[]>("/teams"), []);
  const cals = useAsync(() => api.get<Calendar[]>("/holiday-calendars"), []);
  const settings = useAsync(() => api.get<any>("/admin/settings"), []);
  const st = settings.data;
  return {
    teams: teams.data || [], calendars: cals.data || [], fulltime: st?.fulltime_weekly_minutes || 2520,
    defaults: { locale: st?.default_locale || "en", timezone: st?.default_timezone || "Europe/Zurich", vacation: st?.default_vacation_days ?? 25 },
    ready: !!st,
  };
}

function Users() {
  const [inactive, setInactive] = useState(false);
  const [q, setQ] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [editing, setEditing] = useState<{ id: number } | null>(() => {
    const id = Number(new URLSearchParams(location.search).get("edit"));
    return id ? { id } : null;
  });
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.get<User[]>("/users", { include_inactive: inactive ? 1 : undefined }), [inactive]);
  const refs = useRefs();
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data || []).filter((u) => (!needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
      && (!teamFilter || String(u.team_id ?? "none") === teamFilter));
  }, [data, q, teamFilter]);

  return (
    <div>
      <PageHead title={t("admin.users.title")} sub={t("admin.users.sub")}
        actions={<button class="btn btn-gradient" onClick={() => setCreating(true)}><Icon.plus />{t("admin.users.invite")}</button>} />
      <div class="card">
        <div class="admin-toolbar">
          <input class="input search" type="search" placeholder={t("admin.users.search")} value={q} onInput={(e) => setQ(val(e))} aria-label={t("common.search")} />
          <select class="select" value={teamFilter} onChange={(e) => setTeamFilter(val(e))} aria-label={t("common.team")}>
            <option value="">{t("admin.users.all_teams")}</option>
            {refs.teams.map((tm) => <option key={tm.id} value={String(tm.id)}>{tm.name}</option>)}
            <option value="none">{t("admin.users.no_team")}</option>
          </select>
          <Switch checked={inactive} onChange={setInactive} label={t("admin.users.show_inactive")} />
          <span class="grow" />
          <span class="small muted">{t("admin.users.count", { count: rows.length })}</span>
        </div>
        <ErrorBox error={error} />
        {loading && !data ? <Loading /> : rows.length === 0 ? <Empty icon={<Icon.users />} title={t("admin.users.empty")} /> : (
          <div class="table-wrap">
            <table class="table">
              <thead><tr>
                <th>{t("common.name")}</th><th class="hide-mobile">{t("common.team")}</th><th>{t("common.role")}</th>
                <th>{t("common.status")}</th><th class="hide-mobile">{t("admin.users.last_login")}</th><th />
              </tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} class="clickable" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} onClick={() => setEditing(u)}>
                    <td>
                      <div class="user-cell">
                        <Avatar name={u.name} size="sm" />
                        <div class="who"><div style="font-weight:580">{u.name}</div><div class="small muted">{u.email}</div></div>
                      </div>
                    </td>
                    <td class="hide-mobile">{u.team_name || <span class="faint">–</span>}</td>
                    <td>
                      <div class="row" style="gap:6px">
                        {u.role === "admin" && <span class="badge brand">{t("admin.users.role_admin")}</span>}
                        {u.is_lead && <span class="badge">{t("admin.users.lead")}</span>}
                        {u.capabilities?.includes("hr") && <span class="badge ok">{t("admin.users.cap_hr")}</span>}
                        {u.capabilities?.includes("projects") && <span class="badge">{t("admin.users.cap_projects")}</span>}
                        {u.role !== "admin" && !u.is_lead && <span class="muted small">{t("admin.users.role_employee")}</span>}
                      </div>
                    </td>
                    <td>
                      {!u.is_active ? <span class="badge danger">{t("common.inactive")}</span>
                        : u.invite_pending ? <span class="badge warn">{t("admin.users.invite_pending")}</span>
                          : <span class="badge ok">{t("common.active")}</span>}
                    </td>
                    <td class="hide-mobile small muted">{u.last_login_at ? relativeTime(u.last_login_at) : t("admin.users.never")}</td>
                    <td class="n nowrap">
                      <a class="btn btn-ghost btn-sm btn-icon" href={`/team/member?id=${u.id}`} title={t("admin.users.open_member")} aria-label={t("admin.users.open_member")} onClick={(e) => e.stopPropagation()}><Icon.clock /></a>
                      <button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.edit")}><Icon.edit /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <CreateUser refs={refs} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {editing && <EditUser id={editing.id} refs={refs} onClose={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

type Refs = ReturnType<typeof useRefs>;

function CalendarSelect({ value, onChange, calendars }: { value: number | null; onChange: (v: number | null) => void; calendars: Calendar[] }) {
  return (
    <select class="select" value={value ?? ""} onChange={(e) => onChange(val(e) ? Number(val(e)) : null)}>
      <option value="">{t("admin.users.calendar_default")}</option>
      {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_default ? ` (${t("admin.holidays.default")})` : ""}</option>)}
    </select>
  );
}

function CreateUser({ refs, onClose, onDone }: { refs: Refs; onClose: () => void; onDone: () => void }) {
  // Company defaults (Settings → General) apply to new employees; the administrator's own timezone does not.
  const tzDefault = refs.defaults.timezone;
  const [f, setF] = useState({
    name: "", email: "", role: "employee", team_id: null as number | null, locale: refs.defaults.locale, timezone: tzDefault,
    employment_start: todayIn(tzDefault), vacation_days_per_year: refs.defaults.vacation, holiday_calendar_id: null as number | null,
    pensum_percent: 100, opening_balance_min: 0, send_invite: !!me.value?.smtp_configured,
  });
  const [minutes, setMinutes] = useState<WeekMinutes>(scheduleFromPensum(100, refs.fulltime));
  const { busy, run, fieldErrors, error } = useAction();
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  async function submit(e: Event) {
    e.preventDefault();
    const r = await run(() => api.post("/users", { ...f, employment_start: f.employment_start || null, schedule_minutes: minutes }),
      f.send_invite ? t("admin.users.invited", { email: f.email }) : t("common.saved"));
    if (r) onDone();
  }
  return (
    <Modal wide title={f.send_invite ? t("admin.users.invite_title") : t("admin.users.add_title")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-primary" form="create-user" disabled={busy}>{f.send_invite ? t("admin.users.send_invite") : t("common.create")}</button>
    </>}>
      <form id="create-user" class="stack lg" onSubmit={submit}>
        <ErrorBox error={error} />
        <div class="form-grid">
          <Field label={t("common.name")} error={fieldErrors.name}><input class="input" required value={f.name} onInput={(e) => set({ name: val(e) })} /></Field>
          <Field label={t("common.email")} error={fieldErrors.email}><input class="input" type="email" required value={f.email} onInput={(e) => set({ email: val(e) })} /></Field>
          <Field label={t("common.team")}><TeamSelect value={f.team_id} teams={refs.teams} onChange={(v) => set({ team_id: v })} /></Field>
          <Field label={t("common.role")} help={t("admin.users.role_help")}>
            <select class="select" value={f.role} onChange={(e) => set({ role: val(e) })}>
              <option value="employee">{t("admin.users.role_employee")}</option>
              <option value="admin">{t("admin.users.role_admin")}</option>
            </select>
          </Field>
          <Field label={t("admin.users.language")}>
            <select class="select" value={f.locale} onChange={(e) => set({ locale: val(e) })}>
              {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </Field>
          <Field label={t("admin.users.timezone")}><TimezoneSelect value={f.timezone} onChange={(v) => set({ timezone: v })} /></Field>
          <Field label={t("admin.users.employment_start")} help={t("admin.users.employment_start_help")}>
            <input class="input" type="date" value={f.employment_start} onInput={(e) => set({ employment_start: val(e) })} />
          </Field>
          <Field label={t("admin.users.vacation_days")} help={t("admin.users.vacation_days_help")} error={fieldErrors.vacation_days_per_year}>
            <input class="input" type="number" min={0} max={366} step={0.5} value={f.vacation_days_per_year} onInput={(e) => set({ vacation_days_per_year: Number(val(e)) })} />
          </Field>
          <Field label={t("admin.users.holiday_calendar")} class="full"><CalendarSelect value={f.holiday_calendar_id} calendars={refs.calendars} onChange={(v) => set({ holiday_calendar_id: v })} /></Field>
        </div>
        <div class="stack">
          <div class="row between wrap">
            <h3>{t("admin.schedule.title")}</h3>
            <div class="row">
              <label class="small muted" for="pensum">{t("admin.schedule.pensum")}</label>
              <input id="pensum" class="input num" style="width:90px" type="number" min={1} max={100} value={f.pensum_percent}
                onInput={(e) => { const p = Number(val(e)) || 100; set({ pensum_percent: p }); setMinutes(scheduleFromPensum(p, refs.fulltime)); }} />
              <span class="muted">%</span>
            </div>
          </div>
          <ScheduleEditor minutes={minutes} onChange={setMinutes} />
        </div>
        <div class="form-grid">
          <Field label={t("admin.users.opening_balance")} help={t("admin.users.opening_balance_help")}>
            <DurationInput value={f.opening_balance_min} allowNegative onChange={(v) => set({ opening_balance_min: v })} />
          </Field>
          <div class="field" style="justify-content:flex-end">
            <Switch checked={f.send_invite} onChange={(v) => set({ send_invite: v })} label={t("admin.users.send_invite_now")} />
          </div>
        </div>
      </form>
    </Modal>
  );
}

function EditUser({ id, refs, onClose }: { id: number; refs: Refs; onClose: () => void }) {
  const [tab, setTab] = useState<"profile" | "schedule" | "vacation">("profile");
  const { data: user, loading, reload } = useAsync(() => api.get<User>(`/users/${id}`), [id]);
  return (
    <Modal wide title={user ? user.name : t("common.loading")} onClose={onClose}>
      {loading && !user ? <Loading /> : user && (
        <div>
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: "profile", label: t("admin.users.tab_profile") },
            { value: "schedule", label: t("admin.users.tab_schedule") },
            { value: "vacation", label: t("admin.users.tab_vacation") },
          ]} />
          {tab === "profile" && <ProfileTab user={user} refs={refs} onSaved={reload} onClose={onClose} />}
          {tab === "schedule" && <SchedulePanel user={user} canEdit canDelete onChanged={reload} />}
          {tab === "vacation" && <VacationTab user={user} />}
        </div>
      )}
    </Modal>
  );
}

function ProfileTab({ user, refs, onSaved, onClose }: { user: User; refs: Refs; onSaved: () => void; onClose: () => void }) {
  const [f, setF] = useState({
    name: user.name, email: user.email, role: user.role, team_id: user.team_id, locale: user.locale, timezone: user.timezone,
    employment_start: user.employment_start || "", employment_end: user.employment_end || "",
    vacation_days_per_year: user.vacation_days_per_year, holiday_calendar_id: user.holiday_calendar_id,
  });
  const [confirm, setConfirm] = useState<null | "deactivate" | "password" | "mfa" | "anonymize">(null);
  const { busy, run, fieldErrors, error } = useAction();
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const isSelf = me.value?.user.id === user.id;
  async function save(e: Event) {
    e.preventDefault();
    const r = await run(() => api.patch(`/users/${user.id}`, {
      ...f, employment_start: f.employment_start || null, employment_end: f.employment_end || null,
    }), t("common.saved"));
    if (r) onSaved();
  }
  return (
    <form class="stack lg" onSubmit={save}>
      <ErrorBox error={error} />
      <div class="row wrap" style="gap:8px">
        {!user.is_active ? <span class="badge danger">{t("common.inactive")}</span> : user.invite_pending
          ? <span class="badge warn">{t("admin.users.invite_pending")}</span> : <span class="badge ok">{t("common.active")}</span>}
        {user.led_team_ids && user.led_team_ids.length > 0 && <span class="badge">{t("admin.users.leads_teams", { count: user.led_team_ids.length })}</span>}
        <span class="small muted">{t("admin.users.last_login")}: {user.last_login_at ? relativeTime(user.last_login_at) : t("admin.users.never")}</span>
      </div>
      <div class="form-grid">
        <Field label={t("common.name")} error={fieldErrors.name}><input class="input" required value={f.name} onInput={(e) => set({ name: val(e) })} /></Field>
        <Field label={t("common.email")} error={fieldErrors.email}><input class="input" type="email" required value={f.email} onInput={(e) => set({ email: val(e) })} /></Field>
        <Field label={t("common.team")}><TeamSelect value={f.team_id} teams={refs.teams} onChange={(v) => set({ team_id: v })} /></Field>
        <Field label={t("admin.users.capabilities")} help={t("admin.users.capabilities_help")} class="full">
          <div class="stack sm">
            <Switch checked={(f.capabilities || []).includes("hr")} onChange={(v) => set({ capabilities: v ? [...(f.capabilities || []).filter((c: string) => c !== "hr"), "hr"] : (f.capabilities || []).filter((c: string) => c !== "hr") })} label={t("admin.users.cap_hr_long")} />
            <Switch checked={(f.capabilities || []).includes("projects")} onChange={(v) => set({ capabilities: v ? [...(f.capabilities || []).filter((c: string) => c !== "projects"), "projects"] : (f.capabilities || []).filter((c: string) => c !== "projects") })} label={t("admin.users.cap_projects_long")} />
          </div>
        </Field>
        <Field label={t("common.role")} help={isSelf ? t("admin.users.self_role_help") : undefined}>
          <select class="select" value={f.role} onChange={(e) => set({ role: val(e) as User["role"] })}>
            <option value="employee">{t("admin.users.role_employee")}</option>
            <option value="admin">{t("admin.users.role_admin")}</option>
          </select>
        </Field>
        <Field label={t("admin.users.language")}>
          <select class="select" value={f.locale} onChange={(e) => set({ locale: val(e) })}>
            {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </Field>
        <Field label={t("admin.users.timezone")}><TimezoneSelect value={f.timezone} onChange={(v) => set({ timezone: v })} /></Field>
        <Field label={t("admin.users.employment_start")}><input class="input" type="date" value={f.employment_start} onInput={(e) => set({ employment_start: val(e) })} /></Field>
        <Field label={t("admin.users.employment_end")} help={t("admin.users.employment_end_help")} error={fieldErrors.employment_end}><input class="input" type="date" value={f.employment_end} onInput={(e) => set({ employment_end: val(e) })} /></Field>
        <Field label={t("admin.users.vacation_days")}>
          <input class="input" type="number" min={0} max={366} step={0.5} value={f.vacation_days_per_year} onInput={(e) => set({ vacation_days_per_year: Number(val(e)) })} />
        </Field>
        <Field label={t("admin.users.holiday_calendar")}><CalendarSelect value={f.holiday_calendar_id} calendars={refs.calendars} onChange={(v) => set({ holiday_calendar_id: v })} /></Field>
      </div>
      <div class="row between wrap">
        <div class="row wrap">
          {user.is_active && (
            <button type="button" class="btn" onClick={() => safely(() => api.post(`/users/${user.id}/invite`, {}),
              user.invite_pending ? t("admin.users.invite_resent") : t("admin.users.reset_sent"))}>
              <Icon.mail />{user.invite_pending ? t("admin.users.resend_invite") : t("admin.users.send_reset")}
            </button>
          )}
          {!isSelf && user.is_active && (
            <button type="button" class="btn" onClick={() => setConfirm("password")}><Icon.key />{t("admin.users.set_password")}</button>
          )}
          {!isSelf && (user.is_active
            ? <button type="button" class="btn btn-danger" onClick={() => setConfirm("deactivate")}>{t("admin.users.deactivate")}</button>
            : <button type="button" class="btn" onClick={async () => { if (await safely(() => api.patch(`/users/${user.id}`, { is_active: true }), t("admin.users.reactivated"))) onSaved(); }}>{t("admin.users.reactivate")}</button>)}
          {!isSelf && user.mfa_enabled && <button type="button" class="btn" onClick={() => setConfirm("mfa")}><Icon.shield />{t("admin.users.reset_mfa")}</button>}
          <button type="button" class="btn btn-ghost" onClick={() => download(`/users/${user.id}/export`, undefined, "resorixtrack-export.json")}><Icon.download />{t("admin.users.export")}</button>
          {!isSelf && !user.is_active && <button type="button" class="btn btn-ghost danger-text" onClick={() => setConfirm("anonymize")}>{t("admin.users.anonymize")}</button>}
        </div>
        <div class="row">
          <button type="button" class="btn btn-ghost" onClick={onClose}>{t("common.close")}</button>
          <button class="btn btn-primary" disabled={busy}>{t("common.save")}</button>
        </div>
      </div>
      {confirm === "password" && <SetPasswordModal user={user} onClose={() => setConfirm(null)} onDone={() => { setConfirm(null); onSaved(); }} />}
      {confirm === "mfa" && <PasswordConfirmModal title={t("admin.users.reset_mfa_title", { name: user.name })} message={t("admin.users.reset_mfa_message")}
        confirmLabel={t("admin.users.reset_mfa")} onClose={() => setConfirm(null)}
        onConfirm={async (pw) => { await api.post(`/users/${user.id}/mfa/reset`, { admin_password: pw }); toast(t("admin.users.reset_mfa_ok")); onSaved(); }} />}
      {confirm === "anonymize" && <PasswordConfirmModal danger title={t("admin.users.anonymize_title", { name: user.name })} message={t("admin.users.anonymize_message")}
        confirmLabel={t("admin.users.anonymize")} onClose={() => setConfirm(null)}
        onConfirm={async (pw) => { await api.post(`/users/${user.id}/anonymize`, { admin_password: pw, force: true }); toast(t("admin.users.anonymized")); onSaved(); }} />}
      {confirm === "deactivate" && (
        <Confirm danger title={t("admin.users.deactivate_title", { name: user.name })}
          message={<>{t("admin.users.deactivate_message", { name: user.name })}{user.led_team_ids && user.led_team_ids.length > 0 && <div class="alert warn small" style="margin-top:10px">{t("admin.users.deactivate_lead_warning", { name: user.name })}</div>}</>}
          confirmLabel={t("admin.users.deactivate")} onClose={() => setConfirm(null)}
          onConfirm={async () => { if (await safely(() => api.patch(`/users/${user.id}`, { is_active: false }), t("admin.users.deactivated"))) onSaved(); }} />
      )}
    </form>
  );
}

function generatePassword(): string {
  // 4 groups of 5 characters from an unambiguous alphabet (~95 bits), e.g. "k7Fp2-xQm9R-..."
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(20);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
}

function SetPasswordModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirmPw] = useState("");
  const [visible, setVisible] = useState(false);
  const [notify, setNotify] = useState(true);
  const [adminPassword, setAdminPassword] = useState("");
  const { busy, run, fieldErrors } = useAction();
  const mismatch = confirm !== "" && confirm !== password;
  async function submit(e: Event) {
    e.preventDefault();
    if (password !== confirm) return;
    const r = await run(() => api.post(`/users/${user.id}/password`, { password, notify, admin_password: adminPassword }),
      t("admin.users.password_set_ok", { name: user.name }));
    if (r) onDone();
  }
  return (
    <Modal title={t("admin.users.set_password_title", { name: user.name })} onClose={onClose} footer={<>
      <button type="button" class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button type="submit" form="set-pw" class="btn btn-primary" disabled={busy || !password || password !== confirm || !adminPassword}><Icon.key />{t("admin.users.set_password")}</button>
    </>}>
      <form id="set-pw" class="stack lg" onSubmit={submit}>
        <div class="alert warn small">{t("admin.users.set_password_help")}</div>
        <Field label={t("auth.new_password")} help={t("auth.password_rules")} error={fieldErrors.password}>
          <div class="row" style="gap:6px">
            <input class="input mono" type={visible ? "text" : "password"} autocomplete="new-password" required minLength={10} value={password}
              onInput={(e) => setPassword(val(e))} />
            <button type="button" class="btn" onClick={() => setVisible(!visible)}>{visible ? t("admin.users.hide") : t("admin.users.show")}</button>
          </div>
        </Field>
        <Field label={t("auth.confirm_password")} error={mismatch ? t("auth.passwords_differ") : undefined}>
          <input class="input mono" type={visible ? "text" : "password"} autocomplete="new-password" required value={confirm} onInput={(e) => setConfirmPw(val(e))} />
        </Field>
        <div class="row wrap">
          <button type="button" class="btn btn-sm" onClick={() => { const pw = generatePassword(); setPassword(pw); setConfirmPw(pw); setVisible(true); }}>
            <Icon.sparkle />{t("admin.users.generate")}
          </button>
          {password && visible && <button type="button" class="btn btn-sm btn-ghost" onClick={() => navigator.clipboard?.writeText(password)}>{t("common.copy")}</button>}
        </div>
        <Switch checked={notify} onChange={setNotify} label={t("admin.users.notify_password")} />
        <Field label={t("admin.users.admin_password")} help={t("admin.users.admin_password_help")} error={fieldErrors.admin_password}>
          <input class="input" type="password" autocomplete="current-password" required value={adminPassword} onInput={(e) => setAdminPassword(val(e))} />
        </Field>
      </form>
    </Modal>
  );
}

function VacationTab({ user }: { user: User }) {
  const thisYear = Number(todayIn(user.timezone).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const { data, loading, reload } = useAsync(() => api.get<any>(`/accounts/${user.id}/vacation`, { year }), [year]);
  const [days, setDays] = useState<string>("");
  const [note, setNote] = useState("");
  const { busy, run } = useAction();
  async function save(value: number | null) {
    const r = await run(() => api.put(`/accounts/${user.id}/entitlements/${year}`, { days: value, note }), t("common.saved"));
    if (r) { setDays(""); setNote(""); reload(); }
  }
  return (
    <div class="stack lg">
      <div class="row between wrap">
        <div class="row">
          <button class="btn btn-icon btn-sm" aria-label={t("common.previous")} onClick={() => setYear(year - 1)}><Icon.chevronLeft /></button>
          <strong class="num" style="min-width:50px;text-align:center">{year}</strong>
          <button class="btn btn-icon btn-sm" aria-label={t("common.next_period")} onClick={() => setYear(year + 1)}><Icon.chevronRight /></button>
        </div>
        <span class="small muted">{t("admin.vacation.default_days", { days: fmtDays(user.vacation_days_per_year) })}</span>
      </div>
      {loading && !data ? <Loading /> : data && (
        <div class="grid cols-4">
          {[
            ["carried_over", data.carried_over], ["entitlement", data.entitlement], ["taken", data.taken], ["remaining", data.remaining],
          ].map(([k, v]) => (
            <div key={k as string} class="card flat stat" style="padding:14px">
              <div class="label">{t(`admin.vacation.${k}`)}</div>
              <div class="value" style="font-size:1.35rem">{fmtDays(v as number)}</div>
              {k === "entitlement" && data.entitlement_overridden && <div class="hint"><span class="badge brand">{t("admin.vacation.overridden")}</span></div>}
            </div>
          ))}
        </div>
      )}
      <div class="card flat stack" style="background:var(--color-surface-2)">
        <h3>{t("admin.vacation.override_title", { year })}</h3>
        <p class="small muted">{t("admin.vacation.override_help")}</p>
        <div class="form-grid">
          <Field label={t("admin.vacation.days")}><input class="input num" type="number" min={0} max={366} step={0.5} value={days} onInput={(e) => setDays(val(e))} /></Field>
          <Field label={t("common.note")}><input class="input" value={note} onInput={(e) => setNote(val(e))} placeholder={t("admin.vacation.note_placeholder")} /></Field>
        </div>
        <div class="row end">
          {data?.entitlement_overridden && <button class="btn btn-ghost" disabled={busy} onClick={() => save(null)}>{t("admin.vacation.reset")}</button>}
          <button class="btn btn-primary" disabled={busy || days === ""} onClick={() => save(Number(days))}>{t("common.save")}</button>
        </div>
      </div>
    </div>
  );
}

