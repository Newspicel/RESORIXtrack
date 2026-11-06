// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { expect, test } from "@playwright/test";
import { EMPLOYEE, login } from "./helpers";

test("mobile: navigation drawer and clock work", async ({ page }) => {
  await login(page, EMPLOYEE);
  await page.getByRole("button", { name: /^menu$/i }).click();
  await expect(page.locator(".app.nav-open")).toBeVisible();
  await page.getByRole("link", { name: "Absences" }).click();
  await expect(page).toHaveURL(/\/absences/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
