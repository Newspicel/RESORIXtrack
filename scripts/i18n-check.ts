/**
 * Verifies translations: every locale has the same keys as English (with the same {placeholders}), and
 * every t("literal.key") used in the source exists. Usage: pnpm i18n:check  (exit 1 on problems)
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { isRecord } from "../src/lib/guards"

const root = join(import.meta.dirname, "../src")
const i18nDir = join(root, "i18n")
const locales = readdirSync(i18nDir).filter((d) => statSync(join(i18nDir, d)).isDirectory())
// namespaces whose keys are data lookups (not UI strings) and may legitimately differ per locale
const DATA_NAMESPACES = new Set(["holidays"])

type Flat = Record<string, string>
function flatten(obj: Record<string, unknown>, prefix = "", out: Flat = {}): Flat {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (isRecord(v)) flatten(v, key, out)
    else out[key] = String(v)
  }
  return out
}

const keys: Record<string, Flat> = {}
for (const loc of locales) {
  keys[loc] = {}
  for (const f of readdirSync(join(i18nDir, loc)).filter((name) => name.endsWith(".json"))) {
    const ns = f.replace(/\.json$/, "")
    if (DATA_NAMESPACES.has(ns)) continue
    Object.assign(keys[loc], flatten(JSON.parse(readFileSync(join(i18nDir, loc, f), "utf8")), ns))
  }
}

let problems = 0
const en = keys.en
const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()
for (const loc of locales.filter((l) => l !== "en")) {
  for (const k of Object.keys(en))
    if (!(k in keys[loc])) {
      console.log(`[${loc}] missing: ${k}`)
      problems++
    }
  for (const k of Object.keys(keys[loc]))
    if (!(k in en)) {
      console.log(`[${loc}] not in en: ${k}`)
      problems++
    }
  for (const [k, v] of Object.entries(keys[loc]))
    if (k in en && ph(en[k]) !== ph(v)) {
      console.log(`[${loc}] placeholder mismatch in ${k}: ${ph(en[k])} vs ${ph(v)}`)
      problems++
    }
}

function walk(dir: string, files: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) {
      if (f !== "i18n") walk(p, files)
    } else if (/\.tsx?$/.test(f)) files.push(p)
  }
  return files
}
const used = new Set<string>()
for (const file of walk(root)) {
  const src = readFileSync(file, "utf8")
  for (const m of src.matchAll(/\bt\(\s*"([a-z_]+\.[a-zA-Z0-9_.]+)"/g)) used.add(m[1])
}
for (const k of used)
  if (!(k in en) && !(`${k}_one` in en) && !(`${k}_other` in en)) {
    console.log(`[en] used in code but missing: ${k}`)
    problems++
  }

if (problems) {
  console.log(`\n${problems} i18n problem(s) across ${locales.join(", ")}`)
  process.exit(1)
}
console.log(
  `i18n OK: ${Object.keys(en).length} keys, locales: ${locales.join(", ")}, ${used.size} literal keys used in code`,
)
