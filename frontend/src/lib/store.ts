// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { signal } from "@preact/signals";
import { api } from "./api";
import { setLocale } from "./i18n";

export interface User {
  id: number;
  email: string;
  name: string;
  role: "admin" | "employee";
  team_id: number | null;
  team_name: string | null;
  is_lead: boolean;
  is_active: boolean;
  timezone: string;
  locale: string;
  employment_start: string | null;
  employment_end: string | null;
  vacation_days_per_year: number;
  holiday_calendar_id: number | null;
  invite_pending: boolean;
  led_team_ids?: number[];
  notify_email_on_correction?: boolean;
  schedules?: Schedule[];
  last_login_at?: string | null;
  mfa_enabled?: boolean;
  capabilities?: string[];
}

export interface Schedule {
  id: number;
  user_id: number;
  valid_from: string;
  pensum_percent: number;
  minutes: Record<string, number>;
  weekly_minutes: number;
}

export interface Me {
  user: User;
  csrf_token: string | null;
  permissions: { admin: boolean; lead: boolean; hr: boolean; projects: boolean; manager: boolean; lead_can_edit_schedules: boolean; lead_can_adjust_balances: boolean };
  unread_notifications: number;
  company_name: string;
  version?: string | null;
  smtp_configured?: boolean | null;
  weekly_max_minutes?: number;
  session_remember_days?: number;
  fulltime_weekly_minutes?: number;
  mfa_enabled?: boolean;
  mfa_required_for_admins?: boolean;
  mfa_required?: boolean;
  api_tokens_enabled?: boolean;
  worklog?: { mode: "off" | "optional" | "required"; percent: number; project_required: boolean };
}

export const me = signal<Me | null>(null);
export const unread = signal(0);
export const pendingApprovals = signal(0);

export async function loadMe(): Promise<Me> {
  const data = await api.get<Me>("/me");
  me.value = data;
  unread.value = data.unread_notifications;
  if (data.user.locale) setLocale(data.user.locale);
  return data;
}

export function tz(): string {
  return me.value?.user.timezone || "Europe/Zurich";
}

/** Sees the Team section: team leads/deputies and HR (administrators only when they also hold HR). */
export function isManager(): boolean {
  return !!me.value && (me.value.permissions.hr || me.value.permissions.lead);
}

// ------------------------------------------------------------------ theme
export type Theme = "dark" | "light";
const THEME_KEY = "rt.theme";

export function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme) || "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ toasts
export interface Toast { id: number; kind: "ok" | "error" | "info"; text: string }
export const toasts = signal<Toast[]>([]);
let toastId = 0;

export function toast(text: string, kind: Toast["kind"] = "ok", ms = 4200) {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, kind, text }];
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== id)), ms);
}

/** Bump to make data views reload (e.g. after a clock action in the top bar). */
export const dataVersion = signal(0);
export function bumpData() {
  dataVersion.value++;
}
