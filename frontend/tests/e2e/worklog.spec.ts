// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { expect, test } from "@playwright/test";
import { CLOCK_USER, LEAD, asUser, login } from "./helpers";

test("employee logs what they did; the item appears in the week view", async ({ page }) => {
  await login(page, CLOCK_USER);
  await page.goto("/time");
  const card = page.locator(".card", { hasText: /work log/i }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /add what you did/i }).click();
  await card.locator("textarea").fill("E2E: firmware debugging session");
  await card.getByRole("button", { name: /^save$/i }).click();
  await expect(page.locator(".toast")).toContainText(/saved/i);
  await expect(card.getByText("E2E: firmware debugging session")).toBeVisible();
});

test("team lead names a deputy for a period and sees it listed", async ({ browser }) => {
  const lead = await asUser(browser, LEAD);
  await lead.page.goto("/team");
  const card = lead.page.locator(".card", { hasText: /leads and deputies/i }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /name a deputy/i }).first().click();
  await card.getByRole("combobox").fill("anna");
  await card.getByRole("option", { name: /Anna Meier/ }).click();
  await card.getByRole("button", { name: /^save$/i }).click();
  await expect(lead.page.locator(".toast")).toContainText(/deputy named/i);
  await expect(card.getByText("Anna Meier")).toBeVisible();
  await lead.ctx.close();
});

test("employee logs an item with exact times; the duration follows", async ({ page }) => {
  await login(page, CLOCK_USER);
  await page.goto("/time");
  const card = page.locator(".card", { hasText: /work log/i }).first();
  await card.getByRole("button", { name: /add what you did/i }).click();
  await card.getByRole("radio", { name: /from – to/i }).click();
  await card.getByLabel(/^from$/i).fill("09:00");
  await card.getByLabel(/^to$/i).fill("10:30");
  await expect(card.getByText(/1:30/)).toBeVisible();
  await card.locator("textarea").fill("E2E: timed item");
  await card.getByRole("button", { name: /^save$/i }).click();
  await expect(page.locator(".toast")).toContainText(/saved/i);
  await expect(card.getByText("09:00–10:30")).toBeVisible();
});
