// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { expect, test } from "@playwright/test";
import { ADMIN, LEAD, asUser } from "./helpers";

const MEMBER = "anna.meier@example.nomail"; // RF Engineering (German UI in the profile)

function previousMonthDay(day = 12): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  d.setUTCDate(day);
  return d.toISOString().slice(0, 10);
}

test("lead signs off last month → member's entries are read-only → admin reopens", async ({ browser }) => {
  const lead = await asUser(browser, LEAD);
  await lead.page.goto("/team/signoff");
  const row = lead.page.locator("tr", { hasText: "Anna Meier" });
  await row.locator('input[type="checkbox"]').check();
  await lead.page.getByRole("button", { name: /sign off \(1\)/i }).click();
  await lead.page.getByRole("dialog").getByRole("button", { name: /^sign off$/i }).click();
  await expect(row.getByText("Signed off")).toBeVisible();
  // the lead can't edit it either
  const res = await lead.page.request.get(`/api/v1/days?from=${previousMonthDay(1)}&to=${previousMonthDay(28)}&user_id=${await row.locator("a").getAttribute("href").then((h) => new URL(h!, "http://x").searchParams.get("id"))}`);
  expect(Object.keys((await res.json()).locked_months)).toHaveLength(1);
  await lead.ctx.close();

  const member = await asUser(browser, MEMBER);
  await member.page.goto(`/time?date=${previousMonthDay()}`);
  await expect(member.page.locator(".alert", { hasText: /signed off|abgezeichnet/i }).first()).toBeVisible();
  await member.page.locator("table.table tbody tr").first().click();
  const dlg = member.page.getByRole("dialog");
  await expect(dlg.getByText(/read-only|schreibgeschützt/i)).toBeVisible();
  await expect(dlg.getByRole("button", { name: /^(save|speichern)$/i })).toHaveCount(0);
  // the API refuses as well, even when bypassing the UI
  const csrf = (await member.ctx.cookies()).find((c) => c.name === "rt_csrf")!.value;
  const entries = await (await member.page.request.get(`/api/v1/entries?from=${previousMonthDay(1)}&to=${previousMonthDay(28)}`)).json();
  const patch = await member.page.request.patch(`/api/v1/entries/${entries[0].id}`, {
    data: { note: "hack", reason: "hack" }, headers: { "X-CSRF-Token": csrf },
  });
  expect(patch.status()).toBe(409);
  expect((await patch.json()).error.code).toBe("period_signed_off");
  await member.ctx.close();

  const admin = await asUser(browser, ADMIN);
  const adminCsrf = (await admin.ctx.cookies()).find((c) => c.name === "rt_csrf")!.value;
  await admin.page.request.patch("/api/v1/me", { data: { locale: "en" }, headers: { "X-CSRF-Token": adminCsrf } });
  await admin.page.goto("/team/signoff");
  await admin.page.getByRole("button", { name: /run check/i }).click();
  await expect(admin.page.getByText(/sign-offs are intact/i)).toBeVisible();
  await admin.page.locator("tr", { hasText: "Anna Meier" }).getByRole("button", { name: /reopen/i }).click();
  const d = admin.page.getByRole("dialog");
  await d.locator("textarea").fill("Missing customer visit");
  await d.getByRole("button", { name: /reopen/i }).click();
  await expect(admin.page.locator("tr", { hasText: "Anna Meier" }).getByText("Ready to sign off")).toBeVisible();
  await admin.ctx.close();
});
