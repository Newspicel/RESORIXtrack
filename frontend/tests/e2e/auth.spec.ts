// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { expect, test } from "@playwright/test";
import { EMPLOYEE, PASSWORD, login } from "./helpers";

test("wrong password shows an error and keeps the user on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", EMPLOYEE);
  await page.fill("#password", "definitely-wrong");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("alert")).toContainText(/incorrect/i);
  await expect(page).toHaveURL(/\/login/);
});

test("protected pages redirect to login and back", async ({ page }) => {
  await page.goto("/absences");
  await expect(page).toHaveURL(/\/login\?next=%2Fabsences/);
  await page.fill("#email", EMPLOYEE);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/absences$/);
});

test("keep me signed in sets a 30-day session cookie", async ({ page, context }) => {
  await login(page, EMPLOYEE);
  const cookie = (await context.cookies()).find((c) => c.name === "rt_session")!;
  expect(cookie.httpOnly).toBe(true);
  const days = (cookie.expires - Date.now() / 1000) / 86400;
  expect(days).toBeGreaterThan(29);
  expect(days).toBeLessThan(31);
});

test("sign out", async ({ page }) => {
  await login(page, EMPLOYEE);
  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("employees cannot open team or admin pages", async ({ page }) => {
  await login(page, EMPLOYEE);
  await expect(page.getByRole("link", { name: /team overview/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /employees/i })).toHaveCount(0);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/team"); // employees see their team's calendar, but no balances
  await expect(page.locator("main h1").first()).toHaveText(/team calendar/i);
  await expect(page.getByText(/time balances/i)).toHaveCount(0);
  await page.goto("/team/approvals");
  await expect(page).toHaveURL(/\/$/);
});
