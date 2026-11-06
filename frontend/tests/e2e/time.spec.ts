// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { expect, test } from "@playwright/test";
import { CLOCK_USER, EMPLOYEE, LEAD, asUser, login } from "./helpers";

test("quick entry: start, break, resume, stop", async ({ page }) => {
  await login(page, CLOCK_USER);
  const card = page.locator(".hero-card");
  await card.getByRole("button", { name: /^clock in$/i }).click();
  await expect(card.getByText(/you're clocked in/i)).toBeVisible();
  await card.getByRole("button", { name: /start break/i }).click();
  await expect(card.getByText(/you're on a break/i)).toBeVisible();
  await card.getByRole("button", { name: /end break/i }).click();
  await expect(card.getByText(/you're clocked in/i)).toBeVisible();
  await card.getByRole("button", { name: /clock out/i }).click();
  await expect(card.getByText(/you're not clocked in/i)).toBeVisible();
  // the top bar widget reflects the state on every page
  await page.goto("/time");
  await expect(page.locator(".mini-clock")).toContainText(/not clocked in/i);
});

test("keyboard shortcut S starts and stops the clock", async ({ page }) => {
  await login(page, CLOCK_USER);
  await expect(page.locator(".mini-clock")).toContainText(/not clocked in/i);
  await page.locator("main h1").click(); // focus the page, not an input
  await page.keyboard.press("s");
  await expect(page.locator(".mini-clock")).toContainText(/working/i);
  await page.keyboard.press("s");
  await expect(page.locator(".mini-clock")).toContainText(/not clocked in/i);
});

test("past entries need a reason and edits are visible in the history", async ({ page }) => {
  await login(page, EMPLOYEE);
  await page.goto("/time?add=1");
  const dialog = page.getByRole("dialog");
  const yesterday = new Date(Date.now() - 86400000 * 1).toISOString().slice(0, 10);
  await dialog.locator('input[type="date"]').fill(yesterday);
  await dialog.locator('input[type="time"]').nth(0).fill("05:00");
  await dialog.locator('input[type="time"]').nth(1).fill("06:15");
  // a past day: the requirement is announced up front and enforced on save
  await expect(dialog.getByText(/a reason is required/i)).toBeVisible();
  await expect(dialog.getByText("Required", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog.getByText(/please enter a reason before saving/i)).toBeVisible();
  await expect(dialog.getByPlaceholder(/forgot to clock in/i)).toBeFocused();
  await dialog.getByPlaceholder(/forgot to clock in/i).fill("Early customer call");
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog).toBeHidden();
  const row = page.locator("tr", { hasText: "05:00 – 06:15" });
  await expect(row).toBeVisible();
  await row.click();
  await page.getByRole("dialog").locator('input[type="time"]').nth(1).fill("06:30");
  await page.getByRole("dialog").getByPlaceholder(/forgot to clock in/i).fill("Call took longer");
  await page.getByRole("dialog").getByRole("button", { name: /^save$/i }).click();
  await page.locator("tr", { hasText: "05:00 – 06:30" }).getByRole("button", { name: /history/i }).click();
  const hist = page.getByRole("dialog");
  await expect(hist.getByText("Recorded")).toBeVisible();
  await expect(hist.getByText("Changed")).toBeVisible();
  await expect(hist.getByText("“Call took longer”")).toBeVisible();
});

test("a lead's correction is flagged for the employee", async ({ browser }) => {
  const lead = await asUser(browser, LEAD);
  // open Marc's time via the team overview
  await lead.page.goto("/team");
  await lead.page.getByRole("link", { name: "Marc Dubois" }).first().click();
  await expect(lead.page.getByRole("heading", { name: "Marc Dubois" })).toBeVisible();
  const entryRow = lead.page.locator("table.table tbody tr").first();
  await entryRow.click();
  const dlg = lead.page.getByRole("dialog");
  await expect(dlg.getByText(/you are changing the time of marc dubois/i)).toBeVisible();
  await dlg.getByPlaceholder(/e\.g\./i).first().fill("Checked with Marc");
  await dlg.getByPlaceholder(/forgot to clock in/i).fill("Corrected after review");
  await dlg.getByRole("button", { name: /^save$/i }).click();
  await expect(dlg).toBeHidden();
  await lead.ctx.close();

  const emp = await asUser(browser, EMPLOYEE);
  await emp.page.getByRole("button", { name: /notifications/i }).click();
  await expect(emp.page.locator(".popover")).toContainText(/Luca Bianchi changed one of your time entries/);
  await emp.ctx.close();
});
