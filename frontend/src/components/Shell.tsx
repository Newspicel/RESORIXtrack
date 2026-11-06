// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../lib/api";
import { loadBranding } from "../lib/branding";
import { clock, clockAction, clockBusy, liveSinceSeconds, liveWorked, loadClock } from "../lib/clock";
import { LOCALES, absenceLabel, locale, setLocale, t } from "../lib/i18n";
import { currentTheme, loadMe, me, pendingApprovals, setTheme, toast, unread } from "../lib/store";
import { fmtDate, fmtDuration, monthName, relativeTime } from "../lib/time";
import { Icon, Logo } from "./icons";
import { Avatar, Loading, Toasts } from "./ui";

type NavKey = "dashboard" | "time" | "absences" | "account" | "team" | "approvals" | "signoff" | "projects" | "reports" | "users" | "teams"
  | "holidays" | "settings" | "backups" | "profile";

export function Shell({ active, title, children, managerOnly, adminOnly }: {
  active: NavKey; title?: string; children: ComponentChildren; managerOnly?: boolean; adminOnly?: boolean;
}) {
  const [ready, setReady] = useState(!!me.value);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    loadBranding().catch(() => {});
    loadMe().then(() => setReady(true)).catch(() => {});
    loadClock().catch(() => {});
  }, []);
  useEffect(() => {
    if (!me.value) return;
    if (me.value.permissions.admin || me.value.permissions.lead || me.value.permissions.hr) {
      api.get<any[]>("/absences/pending").then((x) => (pendingApprovals.value = x.length)).catch(() => {});
    }
  }, [ready]);
  useShortcuts();
  if (!ready || !me.value) return <><Loading /><Toasts /></>;
  const m = me.value;
  const manager = m.permissions.hr || m.permissions.lead;
  const canProjects = manager || m.permissions.projects;
  if ((managerOnly && !manager && !(active === "approvals" && m.permissions.admin) && !(active === "projects" && m.permissions.projects)) || (adminOnly && !m.permissions.admin)) {
    location.replace("/");
    return null;
  }
  const link = (key: NavKey, href: string, icon: ComponentChildren, label: string, count?: number) => (
    <a class={`nav-link ${active === key ? "active" : ""}`} href={href} aria-current={active === key ? "page" : undefined}>
      {icon}<span>{label}</span>{count ? <span class="count">{count}</span> : null}
    </a>
  );
  return (
    <div class={`app ${navOpen ? "nav-open" : ""}`}>
      <div class="scrim" onClick={() => setNavOpen(false)} />
      <aside class="sidebar" aria-label={t("nav.main")}>
        <a class="brand" href="/" style="text-decoration:none;color:inherit" aria-label={t("nav.dashboard")}>
          <Logo height={26} />
        </a>
        <div class="brand-name" style="padding:0 8px 10px;margin-top:-8px">RESORIX<b>track</b></div>
        {link("dashboard", "/", <Icon.dashboard />, t("nav.dashboard"))}
        {link("time", "/time", <Icon.clock />, t("nav.time"))}
        {link("absences", "/absences", <Icon.palm />, t("nav.absences"))}
        {link("account", "/account", <Icon.wallet />, t("nav.account"))}
        {link("reports", "/reports", <Icon.chart />, t("nav.reports"))}
        {!manager && m.user.team_id && link("team", "/team", <Icon.team />, t("nav.team_calendar"))}
        {manager && <div class="nav-section">{t("nav.team_section")}</div>}
        {manager && link("team", "/team", <Icon.team />, t("nav.team"))}
        {manager && link("approvals", "/team/approvals", <Icon.inbox />, t("nav.approvals"), pendingApprovals.value)}
        {manager && link("signoff", "/team/signoff", <Icon.lock />, t("nav.signoff"))}
        {canProjects && m.worklog?.mode !== "off" && link("projects", "/team/projects", <Icon.file />, t("nav.projects"))}
        {!manager && m.permissions.admin && pendingApprovals.value > 0 && link("approvals", "/team/approvals", <Icon.inbox />, t("nav.approvals"), pendingApprovals.value)}
        {m.permissions.admin && <div class="nav-section">{t("nav.admin_section")}</div>}
        {m.permissions.admin && link("users", "/admin/users", <Icon.users />, t("nav.users"))}
        {m.permissions.admin && link("teams", "/admin/teams", <Icon.team />, t("nav.teams"))}
        {m.permissions.admin && link("holidays", "/admin/holidays", <Icon.flag />, t("nav.holidays"))}
        {m.permissions.admin && link("settings", "/admin/settings", <Icon.settings />, t("nav.settings"))}
        {m.permissions.admin && link("backups", "/admin/backups", <Icon.database />, t("nav.backups"))}
        <div class="foot">
          <a class={`nav-link ${active === "profile" ? "active" : ""}`} href="/profile" title={t("nav.profile_hint")}>
            <Avatar name={m.user.name} size="sm" />
            <span class="grow" style="overflow:hidden;min-width:0">
              <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{m.user.name}</span>
              <span class="tiny muted" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{t("nav.profile")}</span>
            </span>
            <Icon.chevronRight width={14} style="opacity:.5;flex:none" />
          </a>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon menu-btn" aria-label={t("nav.menu")} onClick={() => setNavOpen(!navOpen)}><Icon.menu /></button>
          <div class="title grow">{title}</div>
          <MiniClock />
          <Notifications />
          <ThemeToggle />
          <UserMenu />
        </header>
        <main class="content" id="main">{children}</main>
      </div>
      <Toasts />
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      if (document.querySelector(".modal-backdrop")) return;
      const st = clock.value?.state;
      if (!st) return;
      if (e.key === "s" || e.key === "S") clockAction(st === "idle" ? "start" : "stop");
      if (e.key === "b" || e.key === "B") {
        if (st === "working") clockAction("break");
        else if (st === "on_break") clockAction("resume");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

function MiniClock() {
  const c = clock.value;
  if (!c) return null;
  const st = c.state;
  const since = liveSinceSeconds();
  return (
    <div class={`mini-clock hide-mobile state-${st}`} title={t("clock.shortcuts")}>
      {st !== "idle" && <span class="pulse" />}
      <span class="t">{st === "idle" ? fmtDuration(liveWorked()) : fmtClock(since)}</span>
      <span class="small muted">{t(`clock.state.${st}`)}</span>
      {st === "idle" && <button class="btn btn-primary btn-sm" disabled={clockBusy.value} onClick={() => clockAction("start")}><Icon.play />{t("clock.start")}</button>}
      {st === "working" && <>
        <button class="btn btn-sm btn-warn" disabled={clockBusy.value} onClick={() => clockAction("break")} aria-label={t("clock.break")}><Icon.coffee /></button>
        <button class="btn btn-sm" disabled={clockBusy.value} onClick={() => clockAction("stop")} aria-label={t("clock.stop")}><Icon.stop /></button>
      </>}
      {st === "on_break" && <button class="btn btn-primary btn-sm" disabled={clockBusy.value} onClick={() => clockAction("resume")}><Icon.play />{t("clock.resume")}</button>}
    </div>
  );
}

export function fmtClock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function useOutside(ref: { current: HTMLElement | null }, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOut();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
}

function notificationText(n: any): string {
  const p = n.payload || {};
  const myId = me.value?.user.id;
  let kind = n.kind;
  if (kind === "absence_cancelled" && p.user_id === myId) kind = p.actor_id === myId || p.actor_name === me.value?.user.name ? "absence_cancelled_own" : "absence_cancelled_yours";
  const vars: Record<string, string | number> = { ...p, type: absenceLabel(p.type_key || p.type) };
  for (const k of ["start_date", "end_date"]) if (typeof p[k] === "string") vars[k] = fmtDate(p[k], { day: "numeric", month: "short" });
  if (typeof p.month === "string" && /^\d{4}-\d{2}$/.test(p.month)) vars.month = `${monthName(Number(p.month.slice(5, 7)))} ${p.month.slice(0, 4)}`;
  if (p.account === "time" || p.account === "vacation") vars.account = t(`notifications.account_${p.account}`);
  if (kind === "lead_assigned") {
    vars.role = t(`notifications.role_${p.role}`);
    vars.period = p.valid_from || p.valid_to ? `${p.valid_from ? fmtDate(p.valid_from) : "…"} – ${p.valid_to ? fmtDate(p.valid_to) : "…"}` : t("notifications.period_open");
  }
  if (typeof p.amount === "number") vars.amount = p.account === "vacation" ? String(p.amount) : fmtDuration(p.amount, { signed: true });
  return t(`notifications.${kind}`, vars);
}

function notificationHref(n: any): string {
  const p = n.payload || {};
  if (n.kind.startsWith("entry_")) return n.kind === "entry_disputed" ? `/team/member?id=${p.actor_id}` : "/time";
  if (n.kind === "absence_requested" || (n.kind === "absence_cancelled" && p.user_id && p.user_id !== me.value?.user.id)) return "/team/approvals";
  if (n.kind === "absence_reported") return "/team";
  if (n.kind.startsWith("absence_") || n.kind === "attachment_added") return "/absences";
  if (n.kind === "balance_adjusted") return "/account";
  if (n.kind === "month_signed_off") return `/time?view=month&date=${p.month}-01`;
  if (n.kind === "month_reopened") return p.user_id && p.user_id !== me.value?.user.id ? "/team/signoff" : `/time?view=month&date=${p.month}-01`;
  if (n.kind === "clock_reminder") return "/";
  if (n.kind === "token_revoked") return "/profile";
  if (n.kind === "lead_assigned") return "/team";
  return "/";
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const r = await api.get<{ items: any[]; unread: number }>("/notifications");
      setItems(r.items);
      unread.value = r.unread;
    }
  }
  async function markAll() {
    await api.post("/notifications/read", {});
    unread.value = 0;
    setItems((items || []).map((x) => ({ ...x, read: true })));
  }
  return (
    <div class="rel" ref={ref}>
      <button class="btn btn-ghost btn-icon rel" aria-label={unread.value > 0 ? t("notifications.title_unread", { count: unread.value }) : t("notifications.title")} aria-expanded={open} onClick={toggle}>
        <Icon.bell />
        {unread.value > 0 && <span class="badge brand" style="position:absolute;top:2px;right:0;height:17px;padding:0 5px;font-size:.66rem;background:var(--color-brand);color:#fff">{unread.value}</span>}
      </button>
      {open && (
        <div class="popover" style="width:min(380px,90vw);max-height:70vh;overflow-y:auto">
          <div class="row between" style="padding:6px 10px 8px">
            <strong>{t("notifications.title")}</strong>
            {unread.value > 0 && <button class="btn btn-ghost btn-sm" onClick={markAll}>{t("notifications.mark_all")}</button>}
          </div>
          {items === null ? <Loading /> : items.length === 0 ? <div class="empty small">{t("notifications.empty")}</div> : items.map((n) => (
            <a key={n.id} class="item" href={notificationHref(n)} style={n.read ? "opacity:.65" : ""}
              onClick={() => !n.read && api.post("/notifications/read", { ids: [n.id] })}>
              {!n.read && <span class="dot" style="background:var(--color-brand)" />}
              <span class="grow"><span style="display:block">{notificationText(n)}</span><span class="tiny muted">{relativeTime(n.created_at)}</span></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const [theme, setThemeState] = useState(currentTheme());
  return (
    <button class="btn btn-ghost btn-icon" aria-label={theme === "dark" ? t("nav.switch_light") : t("nav.switch_dark")} onClick={() => {
      const next = theme === "dark" ? "light" : "dark";
      setTheme(next);
      setThemeState(next);
    }}>{theme === "dark" ? <Icon.sun /> : <Icon.moon />}</button>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const m = me.value!;
  async function changeLang(code: string) {
    setLocale(code);
    try {
      await api.patch("/me", { locale: code });
    } catch {
      toast(t("errors.generic"), "error");
    }
  }
  return (
    <div class="rel" ref={ref}>
      <button class="btn btn-ghost" style="padding:0 6px" onClick={() => setOpen(!open)} aria-label={t("nav.account_menu")}>
        <Avatar name={m.user.name} size="sm" />
      </button>
      {open && (
        <div class="popover">
          <div style="padding:8px 10px 10px">
            <div style="font-weight:600">{m.user.name}</div>
            <div class="small muted">{m.user.email}</div>
          </div>
          <div class="divider" style="margin:4px 0" />
          <a class="item" href="/profile"><Icon.user width={17} />{t("nav.profile")}</a>
          <a class="item" href="/profile#mfa"><Icon.shield width={17} />{t("profile.mfa.title")}</a>
          {m.api_tokens_enabled !== false && <a class="item" href="/profile#tokens"><Icon.key width={17} />{t("profile.tokens")}</a>}
          <div class="item" style="cursor:default"><Icon.globe width={17} />
            <span class="lang-switch">{LOCALES.map((l) => (
              <button key={l.code} class={locale.value === l.code ? "active" : ""} onClick={() => changeLang(l.code)}>{l.code.toUpperCase()}</button>
            ))}</span>
          </div>
          <div class="divider" style="margin:4px 0" />
          <button class="item" onClick={async () => { await api.post("/auth/logout", {}); location.href = "/login"; }}>
            <Icon.logout width={17} />{t("nav.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
