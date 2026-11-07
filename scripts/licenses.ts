/**
 * License check for the runtime dependencies (`pnpm licenses list --prod --json`).
 *   pnpm tsx scripts/licenses.ts --check   exit 1 when a package's license is outside the allow-list
 *   pnpm tsx scripts/licenses.ts --write   also regenerate the inventory in docs/third-party-licenses.md
 * SPDX expressions: "A OR B" passes when one side is allowed, "A AND B" only when both are.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

const ALLOWED = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "MPL-2.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
  "CC-BY-4.0",
  "CC-BY-3.0", // holiday data in date-holidays (attribution in docs/third-party-licenses.md)
  "MIT-0",
  "Zlib",
  "OFL-1.1", // Inter font
])

/** Non-SPDX spellings of an allowed license. */
const ALIASES: Record<string, string> = {
  "MIT/X11": "MIT",
  "PSF-2.0": "Python-2.0",
}

/** Packages whose license was read and accepted although it is not in ALLOWED: "name": "reason". */
const REVIEWED: Record<string, string> = {
  buffers: "no license field in package.json; MIT/X11 per its README (via exceljs > unzipper > binary)",
}

const root = path.resolve(import.meta.dirname, "..")
const docFile = path.join(root, "docs/third-party-licenses.md")
const START = "<!-- generated:start -->"
const END = "<!-- generated:end -->"

const PkgSchema = z.object({
  name: z.string(),
  versions: z.array(z.string()),
  license: z.string(),
  homepage: z.string().optional(),
})
type Pkg = z.infer<typeof PkgSchema>

function allowed(expr: string): boolean {
  const e = expr.trim().replace(/^\((.*)\)$/, "$1")
  if (/ OR /i.test(e)) return e.split(/ OR /i).some(allowed)
  if (/ AND /i.test(e)) return e.split(/ AND /i).every(allowed)
  return ALLOWED.has(ALIASES[e] ?? e)
}

function load(): Pkg[] {
  const out = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  const byLicense = z.record(z.string(), z.array(PkgSchema)).parse(JSON.parse(out))
  return Object.values(byLicense)
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name))
}

const cell = (s: string) => s.replaceAll("|", "\\|")

function inventory(pkgs: Pkg[]): string {
  const counts = new Map<string, number>()
  for (const p of pkgs) counts.set(p.license, (counts.get(p.license) ?? 0) + 1)
  const summary = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return [
    `${pkgs.length} runtime packages.`,
    "",
    "| License | Packages |",
    "|---|---|",
    ...summary.map(([l, n]) => `| ${cell(l)} | ${n} |`),
    "",
    "| Package | Version | License |",
    "|---|---|---|",
    ...pkgs.map((p) => `| ${cell(p.name)} | ${p.versions.join(", ")} | ${cell(p.license)} |`),
  ].join("\n")
}

const args = new Set(process.argv.slice(2))
const pkgs = load()

if (args.has("--write")) {
  const doc = readFileSync(docFile, "utf8")
  const a = doc.indexOf(START)
  const b = doc.indexOf(END)
  if (a < 0 || b < a) throw new Error(`markers ${START} / ${END} missing in ${docFile}`)
  writeFileSync(docFile, `${doc.slice(0, a + START.length)}\n${inventory(pkgs)}\n${doc.slice(b)}`)
  console.log(`wrote ${path.relative(root, docFile)}`)
}

const bad = pkgs.filter((p) => !allowed(p.license) && !(p.name in REVIEWED))
if (bad.length) {
  console.log("Licenses outside the allow-list (review, then extend ALLOWED or REVIEWED in scripts/licenses.ts):")
  for (const p of bad) console.log(`  ${p.name}@${p.versions.join(",")}: ${p.license}`)
  process.exit(1)
}
console.log(`licenses OK: ${pkgs.length} runtime packages`)
