// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { expect, test } from "@playwright/test";
import { EMPLOYEE, LEAD, addDays, asUser, futureMonday } from "./helpers";

test("vacation request → lead approves → employee sees it approved", async ({ browser }) => {
  const start = futureMonday(170);
  const end = addDays(start, 2);
  const emp = await asUser(browser, EMPLOYEE);
  await emp.page.goto("/absences");
  await emp.page.getByRole("button", { name: /request absence/i }).click();
  const dlg = emp.page.getByRole("dialog");
  await dlg.locator('input[type="date"]').nth(0).fill(start);
  await dlg.locator('input[type="date"]').nth(1).fill(end);
  await expect(dlg.getByText(/3 working days/i)).toBeVisible();
  await dlg.getByRole("button", { name: /send request/i }).click();
  await expect(emp.page.locator(".toast")).toContainText(/request sent/i);

  const lead = await asUser(browser, LEAD);
  await lead.page.goto("/team/approvals");
  const card = lead.page.locator(".card", { hasText: "Marc Dubois" }).filter({ has: lead.page.getByRole("button", { name: /approve/i }) }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /approve/i }).click();
  const confirm = lead.page.getByRole("dialog");
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /approve|confirm/i }).last().click();
  await lead.ctx.close();

  await emp.page.reload();
  const item = emp.page.locator("div.row", { hasText: /Vacation/ }).filter({ hasText: "Approved" });
  await expect(item.first()).toBeVisible();
  await emp.ctx.close();
});

test("employee reports sick (when today is a working day) and can attach a note", async ({ page }) => {
  const { login } = await import("./helpers");
  await login(page, EMPLOYEE);
  await expect(page.locator(".hero-card .ring")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const sick = page.getByRole("button", { name: /report sick/i });
  test.skip(!(await sick.first().isVisible()), "today is not a working day for this user");
  await sick.first().click();
  await page.getByRole("dialog").getByRole("button", { name: /report sick/i }).click();
  await expect(page.getByText(/get well soon/i).first()).toBeVisible();
  await page.goto("/absences");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "arztzeugnis.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await expect(page.getByRole("link", { name: "arztzeugnis.pdf" })).toBeVisible();
});
