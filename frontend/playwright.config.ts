// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 5099);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-GB" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: "./scripts/e2e-server.sh",
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    stdout: "ignore",
    timeout: 60_000,
    env: { E2E_PORT: String(port) },
  },
});
