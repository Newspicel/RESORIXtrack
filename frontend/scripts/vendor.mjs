// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
// Copies third-party browser assets into public/vendor so the app never loads from a CDN.
// Runs automatically before `astro build` and `astro dev` (see package.json).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const swagger = dirname(require.resolve("swagger-ui-dist/package.json"));
const out = join(dirname(new URL(import.meta.url).pathname), "..", "public", "vendor", "swagger-ui");
mkdirSync(out, { recursive: true });
for (const f of ["swagger-ui.css", "swagger-ui-bundle.js", "swagger-ui-standalone-preset.js", "favicon-32x32.png", "LICENSE", "NOTICE"]) {
  copyFileSync(join(swagger, f), join(out, f));
}
// Inter is bundled into the pages; the SIL Open Font License must travel with the font files.
const inter = dirname(require.resolve("@fontsource-variable/inter/package.json"));
const fonts = join(dirname(out), "fonts");
mkdirSync(fonts, { recursive: true });
copyFileSync(join(inter, "LICENSE"), join(fonts, "inter-LICENSE.txt"));
console.log("vendored swagger-ui-dist →", out, "and the Inter font license →", fonts);
