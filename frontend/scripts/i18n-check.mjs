// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
// Verifies translations: every locale has the same keys as English, and every t("literal.key")
// used in the source exists. Usage: node scripts/i18n-check.mjs   (exit 1 on problems)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const i18nDir = join(root, "i18n");
const locales = readdirSync(i18nDir).filter((d) => statSync(join(i18nDir, d)).isDirectory());
// Namespaces whose keys are data lookups (not UI strings) and may legitimately differ per locale.
const DATA_NAMESPACES = new Set(["holidays"]);

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const keys = {};
for (const loc of locales) {
  keys[loc] = {};
  for (const f of readdirSync(join(i18nDir, loc)).filter((f) => f.endsWith(".json"))) {
    const ns = f.replace(/\.json$/, "");
    if (DATA_NAMESPACES.has(ns)) continue;
    Object.assign(keys[loc], flatten(JSON.parse(readFileSync(join(i18nDir, loc, f), "utf8")), ns));
  }
}

let problems = 0;
const en = keys.en;
for (const loc of locales.filter((l) => l !== "en")) {
  const missing = Object.keys(en).filter((k) => !(k in keys[loc]));
  const extra = Object.keys(keys[loc]).filter((k) => !(k in en));
  for (const k of missing) { console.log(`[${loc}] missing: ${k}`); problems++; }
  for (const k of extra) { console.log(`[${loc}] not in en: ${k}`); problems++; }
  for (const [k, v] of Object.entries(keys[loc])) {
    const a = (String(en[k] ?? "").match(/\{\w+\}/g) || []).sort().join();
    const b = (String(v).match(/\{\w+\}/g) || []).sort().join();
    if (k in en && a !== b) { console.log(`[${loc}] placeholder mismatch in ${k}: ${a} vs ${b}`); problems++; }
  }
}

function walk(dir, files = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "i18n") walk(p, files); }
    else if (/\.(tsx?|astro)$/.test(f)) files.push(p);
  }
  return files;
}
const used = new Set();
for (const file of walk(root)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([a-z_]+\.[a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
}
for (const k of used) {
  if (!(k in en) && !(`${k}_one` in en) && !(`${k}_other` in en)) { console.log(`[en] used in code but missing: ${k}`); problems++; }
}

if (problems) {
  console.log(`\n${problems} i18n problem(s) across ${locales.join(", ")}`);
  process.exit(1);
}
console.log(`i18n OK: ${Object.keys(en).length} keys, locales: ${locales.join(", ")}, ${used.size} literal keys used in code`);
