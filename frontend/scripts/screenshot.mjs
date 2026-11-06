// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
// Dev helper: sign in and capture screenshots of pages.
// Usage: node scripts/screenshot.mjs <baseUrl> <email> <password> <outDir> <path> [<path>...]
// Env: THEME=light|dark, WIDTH=1440, HEIGHT=900, LOCALE=en|de
import { chromium } from "@playwright/test";

const [base, email, password, outDir, ...paths] = process.argv.slice(2);
const width = Number(process.env.WIDTH || 1440);
const height = Number(process.env.HEIGHT || 900);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: process.env.THEME === "light" ? "light" : "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
await page.addInitScript(([theme, locale]) => {
  if (theme) localStorage.setItem("rt.theme", theme);
  if (locale) localStorage.setItem("rt.locale", locale);
}, [process.env.THEME || "", process.env.LOCALE || ""]);
if (email) {
  await page.goto(base + "/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit], form button.btn-gradient")]);
  if (process.env.LOCALE) { // the account's saved language wins over localStorage: set it on the profile too
    const csrf = (await ctx.cookies()).find((c) => c.name.endsWith("rt_csrf"))?.value;
    await page.request.patch(base + "/api/v1/me", { data: { locale: process.env.LOCALE }, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
  }
}
for (const p of paths) {
  await page.goto(base + p);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const name = p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: process.env.FULL === "1" });
  console.log("saved", `${outDir}/${name}.png`);
}
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
await browser.close();
