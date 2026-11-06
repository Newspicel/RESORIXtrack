// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
/** Shared clock state (top bar widget + dashboard card) with an offline queue. */
import { signal } from "@preact/signals";
import { ApiError, api } from "./api";
import { t, tError } from "./i18n";
import { bumpData, toast } from "./store";

export type ClockState = "idle" | "working" | "on_break";

export interface ClockData {
  state: ClockState;
  since: string | null;
  today_worked_min: number;
  today_break_min: number;
  server_time: string;
  entry: any;
}

export const clock = signal<ClockData | null>(null);
export const clockBusy = signal(false);
const loadedAt = signal(Date.now());
export const now = signal(Date.now());

if (typeof window !== "undefined") setInterval(() => (now.value = Date.now()), 1000);

const QUEUE_KEY = "rt.clockQueue";

function readQueue(): { action: string; at: string }[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(q: { action: string; at: string }[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}

export async function loadClock() {
  await flushQueue();
  clock.value = await api.get<ClockData>("/clock");
  loadedAt.value = Date.now();
}

/** Minutes worked today, ticking live while working. */
export function liveWorked(): number {
  const c = clock.value;
  if (!c) return 0;
  const elapsed = (now.value - loadedAt.value) / 60000;
  return c.today_worked_min + (c.state === "working" ? elapsed : 0);
}

/** Seconds since the current state started. */
export function liveSinceSeconds(): number {
  const c = clock.value;
  if (!c?.since) return 0;
  return Math.max(0, (now.value - new Date(c.since).getTime()) / 1000);
}

export async function clockAction(action: "start" | "break" | "resume" | "stop") {
  if (clockBusy.value) return;
  clockBusy.value = true;
  const at = new Date().toISOString();
  try {
    clock.value = await api.post<ClockData>(`/clock/${action}`, { at });
    loadedAt.value = Date.now();
    bumpData();
  } catch (e) {
    if (e instanceof ApiError && e.code === "network") {
      // Offline: keep the click with its original timestamp and sync later.
      writeQueue([...readQueue(), { action, at }]);
      toast(t("clock.queued_offline"), "info", 6000);
      optimistic(action, at);
    } else {
      toast(tError(e), "error");
    }
  } finally {
    clockBusy.value = false;
  }
}

function optimistic(action: string, at: string) {
  const c = clock.value;
  if (!c) return;
  const state: ClockState = action === "start" || action === "resume" ? "working" : action === "break" ? "on_break" : "idle";
  clock.value = { ...c, state, since: state === "idle" ? null : at };
}

export async function flushQueue() {
  const q = readQueue();
  if (!q.length) return;
  const rest = [...q];
  while (rest.length) {
    const item = rest[0];
    try {
      await api.post(`/clock/${item.action}`, { at: item.at });
    } catch (e) {
      if (e instanceof ApiError && e.code === "network") break;
      // Conflicts (e.g. already applied) are dropped; the server state wins.
    }
    rest.shift();
  }
  writeQueue(rest);
  if (rest.length === 0 && q.length) toast(t("clock.synced"), "ok");
}

if (typeof window !== "undefined") window.addEventListener("online", () => loadClock().catch(() => {}));
