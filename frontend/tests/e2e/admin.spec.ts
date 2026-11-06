// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { expect, test } from "@playwright/test";
import { ADMIN, PASSWORD, login } from "./helpers";

test("admin pages load without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, ADMIN);
  for (const path of ["/admin/users", "/admin/teams", "/admin/holidays", "/admin/settings", "/admin/backups", "/team", "/team/approvals", "/reports"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main h1").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("Fribourg holidays are installed", async ({ page }) => {
  await login(page, ADMIN);
  const res = await page.request.get("/api/v1/holiday-calendars");
  const cals = await res.json();
  expect(cals.find((c: any) => c.name === "CH-FR City of Fribourg")?.holiday_count).toBe(36);
});

test("admin downloads a backup", async ({ page, context }) => {
  await login(page, ADMIN);
  const csrf = (await context.cookies()).find((c) => c.name === "rt_csrf")!.value;
  expect((await page.request.get("/api/v1/admin/backups/download")).status()).toBe(404); // GET must not create files
  const res = await page.request.post("/api/v1/admin/backups/download", { headers: { "X-CSRF-Token": csrf } });
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect(body.subarray(0, 4).toString()).toBe("RTBK"); // encrypted archive, never a raw ZIP
  expect(body.includes("SQLite format 3")).toBe(false);
  expect(res.headers()["content-disposition"]).toMatch(/\.zip\.enc"?$/);
});

test("admin sets a user's password, the user signs in with it", async ({ browser }) => {
  const { asUser } = await import("./helpers");
  const admin = await asUser(browser, ADMIN);
  const csrf = (await admin.ctx.cookies()).find((c) => c.name === "rt_csrf")!.value;
  await admin.page.request.patch("/api/v1/me", { data: { locale: "en" }, headers: { "X-CSRF-Token": csrf } });
  await admin.page.goto("/admin/users");
  await admin.page.locator("tr", { hasText: "Tim Baumann" }).locator("button").last().click();
  await admin.page.getByRole("button", { name: /set password/i }).click();
  const dlg = admin.page.getByRole("dialog").last();
  await dlg.locator('input[autocomplete="new-password"]').nth(0).fill("Brand-New-Admin-Set-1");
  await dlg.locator('input[autocomplete="new-password"]').nth(1).fill("Brand-New-Admin-Set-1");
  await dlg.locator('input[autocomplete="current-password"]').fill(PASSWORD); // the admin confirms their own password
  await dlg.getByRole("button", { name: /^set password$/i }).click();
  await expect(admin.page.locator(".toast")).toContainText(/password for tim baumann set/i);
  await admin.ctx.close();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "tim.baumann@example.nomail", "Brand-New-Admin-Set-1");
  await expect(page).toHaveURL(/\/$/);
  await ctx.close();
});

test("sign-in page has no marketing copy", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /sign in|anmelden/i })).toBeVisible();
  await expect(page.getByText(/beautifully simple|wunderbar einfach/i)).toHaveCount(0);
});
