// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { expect, test } from "@playwright/test";
import { EMPLOYEE, login } from "./helpers";

async function switchLanguage(page: import("@playwright/test").Page, code: string, saveLabel: RegExp, heading: string) {
  await page.goto("/profile");
  await page.locator("select").first().selectOption(code);
  await page.getByRole("button", { name: saveLabel }).first().click();
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

// Whatever happens, leave the demo employee in English so later specs can rely on English labels.
test.afterEach(async ({ page }) => {
  const csrf = (await page.context().cookies()).find((c) => c.name.endsWith("rt_csrf"))?.value;
  if (csrf) await page.request.patch("/api/v1/me", { data: { locale: "en" }, headers: { "X-CSRF-Token": csrf } });
});

test("switching the language to German and French in the profile", async ({ page }) => {
  await login(page, EMPLOYEE);
  await switchLanguage(page, "de", /^save$/i, "Profil");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Meine Zeit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /einstempeln/i }).first()).toBeVisible();

  await switchLanguage(page, "fr", /^speichern$/i, "Profil");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Mon temps", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /timbrer l'arrivée/i }).first()).toBeVisible();
  await page.goto("/absences");
  await expect(page.getByRole("heading", { name: "Absences" })).toBeVisible();
  await expect(page.getByRole("button", { name: /demander une absence/i })).toBeVisible();

  // switch back so other tests keep English
  await switchLanguage(page, "en", /^enregistrer$/i, "Profile");
});
