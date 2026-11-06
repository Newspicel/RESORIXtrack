// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { type Browser, type Page, expect } from "@playwright/test";

export const PASSWORD = "demo";
export const EMPLOYEE = "marc.dubois@example.nomail"; // RF Engineering, English UI
export const LEAD = "luca.bianchi@example.nomail"; // lead of RF Engineering
export const ADMIN = "admin@example.nomail";
export const CLOCK_USER = "sofia.rossi@example.nomail"; // used only by the clock tests
export const OTHER_TEAM = "lea.schneider@example.nomail"; // Software & DSP

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.addInitScript(() => {
    try { localStorage.setItem("rt.locale", "en"); } catch { /* ignore */ }
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: /sign in|anmelden/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function asUser(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, email);
  return { ctx, page };
}

/** A Monday far enough in the future to not collide with demo data. */
export function futureMonday(daysAhead = 160): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
