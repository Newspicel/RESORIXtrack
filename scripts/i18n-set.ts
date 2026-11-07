/**
 * Set one translation key in every locale (order of LOCALE_CODES):
 *   pnpm tsx scripts/i18n-set.ts <ns.path.key> "<en>" "<de>" "<fr>" "<it>"
 * Several keys at once from a JSON file: pnpm tsx scripts/i18n-set.ts --file keys.json
 *   keys.json: { "ns.key": ["en", "de", "fr", "it"], ... }
 * Creates the namespace file if needed; keeps 2-space JSON formatting.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { LOCALE_CODES } from "../src/lib/locales"

const root = path.resolve(import.meta.dirname, "../src/i18n")
const LOCS = LOCALE_CODES

function set(key: string, values: string[]) {
  const [ns, ...rest] = key.split(".")
  if (!rest.length) throw new Error(`key needs a namespace: ${key}`)
  LOCS.forEach((loc, i) => {
    const file = path.join(root, loc, `${ns}.json`)
    const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
    let cur = data
    for (const p of rest.slice(0, -1)) cur = cur[p] ??= {}
    cur[rest.at(-1)!] = values[i] ?? values[0]
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  })
}

const args = process.argv.slice(2)
if (args[0] === "--file") {
  const entries = z.record(z.string(), z.array(z.string())).parse(JSON.parse(readFileSync(args[1], "utf8")))
  for (const [k, v] of Object.entries(entries)) set(k, v)
  console.log(`set ${Object.keys(entries).length} keys`)
} else {
  set(args[0], args.slice(1))
  console.log(`set ${args[0]}`)
}
