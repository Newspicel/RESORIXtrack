/**
 * Migration from RESORIXtrack 1.x: copies a v1 SQLite database (opened read-only) into a fresh v2 database in
 * one transaction, keeping ids, converting formats, verifying every sign-off seal chain before commit.
 * Attachments are hash-checked before the import and copied after commit; branding logos are copied as is.
 * The v1 files are never modified.
 */
import { createHash } from "node:crypto"
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { setDatabase } from "../db"
import { retireLegacyBreaks } from "../db/legacy-breaks"
import { mergeLegacyWorklogs } from "../db/legacy-worklogs"
import { env } from "../env"
import { checkUserChain, sealKey } from "../services/seals"
import { DEFAULTS, RETIRED_SETTINGS } from "../services/settings"
import { utcnow } from "../time"
import { v1Instant } from "./convert"
import { type ImportContext, SKIPPED, settingKey, TABLES, type V1Row } from "./tables"

/** Alembic revisions of released v1 versions this importer understands. */
export const V1_REVISIONS = ["0001", "0002", "0003"] as const

export class ImportError extends Error {
  /** What was found before the import was aborted. */
  report?: ImportReport
}

export interface Person {
  id: number
  name: string
  email: string
}
export interface SealProblem {
  userId: number
  name: string
  signoffId: number
  month: string
  status: string
}
export interface ImportReport {
  source: string
  revision: string
  target: string
  dryRun: boolean
  forced: boolean
  tables: { table: string; v1: number; v2: number }[]
  skipped: { table: string; rows: number; why: string }[]
  credentials: number
  /** legacy break entries retired during the import (a break is a clock-out) */
  breaksRetired: number
  /** Work log items of open days moved onto the time entries. */
  worklogsMerged: number
  settingsSkipped: string[]
  seals: { people: number; signoffs: number; problems: SealProblem[]; error?: string }
  attachments: { files: number; purged: number; missing: string[]; mismatched: string[]; copied: number }
  branding: string[]
  people: { invite: Person[]; apiKeys: (Person & { tokens: number })[]; twoFactor: Person[] }
  warnings: string[]
}

export interface ImportOptions {
  /** v1 data directory (attachments/, branding/); null skips all file handling. */
  sourceDataDir: string | null
  /** Where to copy files after commit; null = check only (dry run). */
  targetDataDir: string | null
  signoffKey?: string
  force?: boolean
  dryRun?: boolean
  sourceLabel?: string
  targetLabel?: string
}

/** Resolve `--data` (a v1 data directory or the .db file itself). */
export function resolveV1Source(p: string): { dbFile: string; dataDir: string } {
  const abs = path.resolve(p)
  if (!existsSync(abs)) throw new ImportError(`not found: ${abs}`)
  if (statSync(abs).isDirectory()) return { dbFile: path.join(abs, "resorixtrack.db"), dataDir: abs }
  return { dbFile: abs, dataDir: path.dirname(abs) }
}

export function openV1(dbFile: string): Database.Database {
  if (!existsSync(dbFile)) throw new ImportError(`no v1 database at ${dbFile}`)
  return new Database(dbFile, { readonly: true, fileMustExist: true })
}

const q = (name: string) => `"${name.replaceAll('"', '""')}"`
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function tableNames(v1: Database.Database): Set<string> {
  const rows = v1.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  return new Set(rows.map((r) => r.name))
}

function columns(v1: Database.Database, table: string): Set<string> {
  const rows = v1.prepare<[string], { name: string }>("SELECT name FROM pragma_table_info(?)").all(table)
  return new Set(rows.map((r) => r.name))
}

function count(sqlite: Database.Database, table: string): number {
  return sqlite.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${q(table)}`).get()?.n ?? 0
}

export function v1Revision(v1: Database.Database): string {
  if (!tableNames(v1).has("alembic_version"))
    throw new ImportError("not a RESORIXtrack 1.x database (no alembic_version)")
  const row = v1.prepare<[], { version_num: string }>("SELECT version_num FROM alembic_version").get()
  if (!row) throw new ImportError("the v1 database has no schema version; run `flask resorixtrack migrate` in v1 first")
  return row.version_num
}

const people = (v1: Database.Database, sql: string, ...params: string[]) =>
  v1.prepare<string[], Person>(sql).all(...params)

function collectPeople(v1: Database.Database, tables: Set<string>, now: string): ImportReport["people"] {
  const nowV1 = now.replace("T", " ").replace("Z", "")
  const invite = people(
    v1,
    `SELECT id, name, email FROM users WHERE is_active = 1 AND (password_hash IS NULL OR password_hash = ''
     ${tables.has("auth_tokens") ? "OR id IN (SELECT user_id FROM auth_tokens WHERE purpose = 'invite' AND used_at IS NULL AND expires_at > ?)" : ""})
     ORDER BY name`,
    ...(tables.has("auth_tokens") ? [nowV1] : []),
  )
  const apiKeys = tables.has("api_tokens")
    ? v1
        .prepare<[string], Person & { tokens: number }>(
          `SELECT u.id, u.name, u.email, count(*) AS tokens FROM api_tokens t JOIN users u ON u.id = t.user_id
           WHERE t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?) GROUP BY u.id ORDER BY u.name`,
        )
        .all(nowV1)
    : []
  const twoFactor = people(v1, "SELECT id, name, email FROM users WHERE totp_enabled_at IS NOT NULL ORDER BY name")
  return { invite, apiKeys, twoFactor }
}

function anonymizedAt(v1: Database.Database): Map<number, string> {
  const rows = v1
    .prepare<[], { id: number; at: string }>(
      "SELECT entity_id AS id, max(at) AS at FROM revisions WHERE entity = 'user' AND action = 'anonymize' GROUP BY entity_id",
    )
    .all()
  return new Map(rows.map((r) => [r.id, v1Instant(r.at)!]))
}

function copyTable(
  v1: Database.Database,
  target: Database.Database,
  spec: (typeof TABLES)[number],
  ctx: ImportContext,
) {
  const have = columns(v1, spec.from)
  const cols = spec.cols.filter((c) => c.from === undefined || have.has(c.from))
  const insert = target.prepare(
    `INSERT INTO ${q(spec.table)} (${cols.map((c) => q(c.to)).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
  )
  const order = have.has("id") ? "id" : "rowid"
  for (const row of v1.prepare<[], V1Row>(`SELECT * FROM ${q(spec.from)} ORDER BY ${order}`).iterate()) {
    if (spec.filter && !spec.filter(row)) continue
    try {
      insert.run(
        cols.map((c) => {
          const raw = c.from === undefined ? undefined : row[c.from]
          return c.convert ? c.convert(raw, row, ctx) : raw
        }),
      )
    } catch (err) {
      throw new ImportError(`${spec.table} #${JSON.stringify(row.id ?? row.key)}: ${message(err)}`)
    }
  }
}

/** Better Auth credential accounts carrying the v1 Argon2id hashes (same PHC format, passwords keep working). */
function copyCredentials(v1: Database.Database, target: Database.Database): number {
  const rows = v1
    .prepare<[], { id: number; password_hash: string; at: string }>(
      "SELECT id, password_hash, coalesce(password_changed_at, created_at) AS at FROM users WHERE password_hash IS NOT NULL AND password_hash <> '' ORDER BY id",
    )
    .all()
  const insert = target.prepare(
    "INSERT INTO account (account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, 'credential', ?, ?, ?, ?)",
  )
  for (const r of rows) {
    if (!r.password_hash.startsWith("$argon2")) throw new ImportError(`users #${r.id}: password hash is not Argon2`)
    const ms = Temporal.Instant.from(v1Instant(r.at)!).epochMilliseconds
    insert.run(String(r.id), r.id, r.password_hash, ms, ms)
  }
  return rows.length
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/

function checkAttachments(v1: Database.Database, sourceDir: string, report: ImportReport) {
  const rows = v1
    .prepare<[], { id: number; storage_name: string; size: number; sha256: string }>(
      "SELECT id, storage_name, size, sha256 FROM attachments ORDER BY id",
    )
    .all()
  const files: string[] = []
  for (const a of rows) {
    const label = `#${a.id} ${a.storage_name}`
    if (!SAFE_NAME.test(a.storage_name)) {
      report.attachments.mismatched.push(`${label} (invalid name)`)
      continue
    }
    const file = path.join(sourceDir, "attachments", a.storage_name)
    if (!existsSync(file)) {
      // v1 retention purges files and sets size 0 while the row (and its sha256) stays as a record
      if (a.size === 0) report.attachments.purged++
      else report.attachments.missing.push(label)
      continue
    }
    const sha = createHash("sha256").update(readFileSync(file)).digest("hex")
    if (sha !== a.sha256) report.attachments.mismatched.push(label)
    else files.push(a.storage_name)
  }
  report.attachments.files = files.length
  return files
}

const LOGO = /^logo-(dark|light)\.(svg|png)$/

function brandingFiles(sourceDir: string): string[] {
  const dir = path.join(sourceDir, "branding")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => LOGO.test(f))
    .sort()
}

function copyFiles(from: string, to: string, names: string[]): number {
  mkdirSync(to, { recursive: true })
  let copied = 0
  for (const name of names) {
    const dest = path.join(to, name)
    if (existsSync(dest)) {
      if (readFileSync(dest).equals(readFileSync(path.join(from, name)))) continue
      throw new ImportError(`${dest} already exists with different content`)
    }
    copyFileSync(path.join(from, name), dest, constants.COPYFILE_EXCL)
    copied++
  }
  return copied
}

function verifySeals(v1: Database.Database, report: ImportReport, signoffKey: string | undefined) {
  const users = v1
    .prepare<[], { id: number; name: string }>(
      "SELECT DISTINCT s.user_id AS id, u.name FROM month_signoffs s JOIN users u ON u.id = s.user_id ORDER BY s.user_id",
    )
    .all()
  const months = new Map(
    v1
      .prepare<[], { id: number; month: string }>("SELECT id, month FROM month_signoffs")
      .all()
      .map((r) => [r.id, r.month]),
  )
  report.seals.people = users.length
  report.seals.signoffs = months.size
  try {
    const key = sealKey(signoffKey ?? env.signoffKey)
    for (const u of users) {
      for (const [id, status] of checkUserChain(u.id, key)) {
        if (status === "ok") continue
        report.seals.problems.push({ userId: u.id, name: u.name, signoffId: id, month: months.get(id) ?? "?", status })
      }
    }
  } catch (err) {
    report.seals.error = message(err)
  }
}

/**
 * Import `v1` into `target` (a migrated, empty v2 database; it becomes the process-wide database so the
 * services, e.g. the seal verification, run against it). Throws ImportError and leaves `target` untouched
 * on any problem; with `force`, seal and attachment problems are reported instead.
 */
export function importV1(v1: Database.Database, target: Database.Database, opts: ImportOptions): ImportReport {
  const revision = v1Revision(v1)
  if (!(V1_REVISIONS as readonly string[]).includes(revision))
    throw new ImportError(
      `unsupported v1 schema revision ${revision} (supported: ${V1_REVISIONS.join(", ")}); install the latest v1 release and run its migrations first`,
    )
  const tables = tableNames(v1)
  const missing = TABLES.map((t) => t.from).filter((t) => !tables.has(t))
  if (missing.length) throw new ImportError(`v1 database lacks tables: ${missing.join(", ")}`)
  if (count(target, "users") > 0)
    throw new ImportError("the target database already has people; import into a fresh database")

  setDatabase(target)
  const report: ImportReport = {
    source: opts.sourceLabel ?? v1.name,
    revision,
    target: opts.targetLabel ?? target.name,
    dryRun: Boolean(opts.dryRun),
    forced: Boolean(opts.force),
    tables: [],
    skipped: [],
    credentials: 0,
    breaksRetired: 0,
    worklogsMerged: 0,
    settingsSkipped: [],
    seals: { people: 0, signoffs: 0, problems: [] },
    attachments: { files: 0, purged: 0, missing: [], mismatched: [], copied: 0 },
    branding: [],
    people: collectPeople(v1, tables, utcnow()),
    warnings: [],
  }
  for (const [table, why] of Object.entries(SKIPPED)) {
    if (tables.has(table)) report.skipped.push({ table, rows: count(v1, table), why })
  }
  report.settingsSkipped = v1
    .prepare<[], { key: string }>("SELECT key FROM settings ORDER BY key")
    .all()
    .map((r) => r.key)
    .filter((k) => !(settingKey(k) in DEFAULTS) && !RETIRED_SETTINGS.includes(k))
  try {
    run(v1, target, opts, report)
  } catch (err) {
    const e = err instanceof ImportError ? err : new ImportError(message(err))
    e.report = report
    throw e
  }
  return report
}

function run(v1: Database.Database, target: Database.Database, opts: ImportOptions, report: ImportReport) {
  const attachmentFiles = opts.sourceDataDir ? checkAttachments(v1, opts.sourceDataDir, report) : []
  if (opts.sourceDataDir) report.branding = brandingFiles(opts.sourceDataDir)
  else report.warnings.push("files not checked (no v1 data directory)")
  const fileProblems = report.attachments.missing.length + report.attachments.mismatched.length
  if (fileProblems && !opts.force)
    throw new ImportError(
      `${fileProblems} attachment file(s) missing or changed: ${[...report.attachments.missing, ...report.attachments.mismatched].join(", ")}`,
    )

  const ctx: ImportContext = { anonymizedAt: anonymizedAt(v1) }
  target.transaction(() => {
    target.pragma("defer_foreign_keys = ON")
    for (const spec of TABLES) {
      copyTable(v1, target, spec, ctx)
      if (spec.table === "users") report.credentials = copyCredentials(v1, target)
    }
    const broken = target
      .prepare<[], { table: string; rowid: number; parent: string }>(
        'SELECT "table", rowid, parent FROM pragma_foreign_key_check LIMIT 5',
      )
      .all()
    if (broken.length)
      throw new ImportError(
        `dangling references in v1 data: ${broken.map((b) => `${b.table} #${b.rowid} → ${b.parent}`).join(", ")}`,
      )
    for (const spec of TABLES)
      report.tables.push({ table: spec.table, v1: count(v1, spec.from), v2: count(target, spec.table) })
    keepV1Surcharge(target)
    // v1 before its revision 0003 still has break entries; a break is a clock-out now
    report.breaksRetired = retireLegacyBreaks(target)
    // projects live on the time entries now: open days' work log items move there
    report.worklogsMerged = mergeLegacyWorklogs(target)

    verifySeals(v1, report, opts.signoffKey)
    if (report.seals.error && !opts.force) throw new ImportError(`seal verification failed: ${report.seals.error}`)
    if (report.seals.problems.length && !opts.force)
      throw new ImportError(
        `${report.seals.problems.length} sign-off seal(s) do not verify; check --signoff-key (v1 SIGNOFF_KEY or SECRET_KEY)`,
      )
  })()

  if (opts.targetDataDir && opts.sourceDataDir) {
    // the database is committed at this point: a file problem must not read as "nothing imported"
    try {
      report.attachments.copied = copyFiles(
        path.join(opts.sourceDataDir, "attachments"),
        path.join(opts.targetDataDir, "attachments"),
        attachmentFiles,
      )
      copyFiles(path.join(opts.sourceDataDir, "branding"), path.join(opts.targetDataDir, "branding"), report.branding)
    } catch (err) {
      report.warnings.push(
        `database imported, but copying files failed: ${message(err)}. Copy the v1 attachments/ and branding/ folders into the v2 data directory by hand.`,
      )
    }
  }
  if (opts.signoffKey && opts.signoffKey !== env.signoffKey)
    report.warnings.push(
      "set SIGNOFF_KEY in the v2 environment to the v1 key, otherwise imported seals fail verification later",
    )
}

const pad = (s: string | number, n: number) => String(s).padEnd(n)
const list = (title: string, rows: string[]) =>
  rows.length ? [`${title} (${rows.length}):`, ...rows.map((r) => `  - ${r}`)] : [`${title}: none`]
const who = (p: Person) => `${p.name} <${p.email}>`

/** v1 credited the holiday surcharge as time and defaulted to 0 %; v2 defaults to 50 % for payroll only. */
function keepV1Surcharge(target: Database.Database) {
  const row = target
    .prepare<[], { value: string }>("SELECT value FROM settings WHERE key = 'holiday_work_surcharge_percent'")
    .get()
  const percent = Number(row?.value ?? 0) || 0
  const set = target.prepare<[string, string]>("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
  if (!row) set.run("holiday_work_surcharge_percent", "0")
  if (percent > 0) set.run("holiday_work_surcharge_mode", JSON.stringify("time_credit"))
}

export function formatReport(r: ImportReport): string {
  const out: string[] = []
  out.push(`RESORIXtrack 1.x import${r.dryRun ? " (dry run, nothing written)" : ""}${r.forced ? " (--force)" : ""}`)
  out.push(`  source  ${r.source} (schema ${r.revision})`, `  target  ${r.target}`, "")
  out.push(`${pad("table", 24)}${pad("v1", 9)}${pad("v2", 9)}`)
  for (const t of r.tables) {
    const note =
      t.table === "settings" && r.settingsSkipped.length
        ? `  skipped unknown: ${r.settingsSkipped.join(", ")}`
        : t.v1 !== t.v2
          ? "  MISMATCH"
          : ""
    out.push(`${pad(t.table, 24)}${pad(t.v1, 9)}${pad(t.v2, 9)}${note}`)
  }
  out.push(`${pad("account (passwords)", 24)}${pad("", 9)}${pad(r.credentials, 9)}`)
  for (const s of r.skipped) out.push(`${pad(s.table, 24)}${pad(s.rows, 9)}${pad("-", 9)}  not imported: ${s.why}`)
  out.push("")
  const a = r.attachments
  out.push(
    `Attachments: ${a.files} verified (sha256)${r.dryRun ? "" : `, ${a.copied} copied`}, ${a.purged} purged in v1`,
  )
  if (a.missing.length) out.push(...list("  missing", a.missing))
  if (a.mismatched.length) out.push(...list("  changed", a.mismatched))
  out.push(`Branding: ${r.branding.length ? r.branding.join(", ") : "default logos"}`)
  const s = r.seals
  if (s.error) out.push(`Seals: NOT VERIFIED (${s.error})`)
  else out.push(`Seals: ${s.signoffs - s.problems.length}/${s.signoffs} sign-offs of ${s.people} people verified`)
  if (r.breaksRetired) out.push(`Breaks: ${r.breaksRetired} legacy break entries retired (a break is a clock-out)`)
  if (r.worklogsMerged)
    out.push(`Work log: ${r.worklogsMerged} items of open months moved onto the time entries (projects)`)
  for (const p of s.problems) out.push(`  - ${p.name} ${p.month} (#${p.signoffId}): ${p.status}`)
  out.push("")
  out.push(...list("Send an invitation (no password or open v1 invite)", r.people.invite.map(who)))
  out.push(
    ...list(
      "Create new API keys (v1 tokens not migrated)",
      r.people.apiKeys.map((p) => `${who(p)}: ${p.tokens} token(s)`),
    ),
  )
  out.push(...list("Enrol two-factor again (required at next sign-in)", r.people.twoFactor.map(who)))
  out.push("Everyone signs in again (sessions are not migrated).")
  for (const w of r.warnings) out.push(`Warning: ${w}`)
  return out.join("\n")
}
