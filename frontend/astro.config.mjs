// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
// @ts-check
import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

const backend = process.env.RESORIXTRACK_BACKEND || "http://127.0.0.1:5000";

export default defineConfig({
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory", inlineStylesheets: "never" },
  integrations: [preact()],
  devToolbar: { enabled: false },
  server: { port: 4321 },
  vite: {
    server: {
      proxy: {
        "/api": { target: backend, changeOrigin: false },
      },
    },
  },
});
