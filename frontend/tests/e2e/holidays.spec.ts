// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { expect, test } from "@playwright/test";
import { EMPLOYEE, login } from "./helpers";

test("employee sees the applicable public holidays, read-only", async ({ page }) => {
  await login(page, EMPLOYEE);
  await page.getByRole("link", { name: "Public holidays", exact: true }).click();
  await expect(page).toHaveURL(/\/holidays/);
  await expect(page.locator("main h1").first()).toHaveText(/public holidays/i);
  await expect(page.getByText("CH-FR City of Fribourg")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: /Christmas Day/ })).toBeVisible();
  // nothing to edit on this page
  expect(await page.getByRole("button", { name: /add|edit|delete|import/i }).count()).toBe(0);

  // and the API refuses writes from an employee
  const mine = await (await page.request.get("/api/v1/holiday-calendars/mine")).json();
  expect(mine.source).toBe("default");
  const csrf = (await page.context().cookies()).find((c) => c.name === "rt_csrf")!.value;
  const res = await page.request.post(`/api/v1/holiday-calendars/${mine.id}/holidays`,
    { headers: { "X-CSRF-Token": csrf }, data: { date: "2026-12-30", name: "Probe" } });
  expect(res.status()).toBe(403);
});
