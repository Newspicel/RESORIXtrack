import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createDb,
  DatabaseVersionError,
  MIGRATIONS_DIR,
  migrationStatus,
  openSqlite,
  rawSqlite,
  runMigrations,
} from "@/server/db"
import { RETIRE_LEGACY_BREAKS } from "@/server/db/legacy-breaks"
import { env } from "@/server/env"
import { migrateDatabase } from "./migrate"

let dir: string
let lines: string[]
const saved = { ...env }
const log = (l: string) => lines.push(l)
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rt-migrate-"))
  lines = []
  Object.assign(env, {
    dataDir: dir,
    backupsDir: path.join(dir, "backups"),
    backupPassword: "migrate-test-password",
    setupCodeRequired: true,
  })
})

afterEach(() => {
  try {
    rawSqlite().close()
  } catch {}
  Object.assign(env, saved)
  rmSync(dir, { recursive: true, force: true })
})

/** A migrations folder with only the first `n` migrations: a database migrated with it is "older". */
function olderFolder(n: number): string {
  const folder = path.join(dir, "older")
  mkdirSync(path.join(folder, "meta"), { recursive: true })
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"))
  journal.entries = journal.entries.slice(0, n)
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify(journal))
  for (const e of journal.entries)
    copyFileSync(path.join(MIGRATIONS_DIR, `${e.tag}.sql`), path.join(folder, `${e.tag}.sql`))
  return folder
}

function olderDatabase(file: string, withUser: boolean) {
  const sqlite = openSqlite(file)
  runMigrations(createDb(sqlite), olderFolder(2))
  if (withUser) sqlite.prepare("INSERT INTO users (email, name) VALUES ('ada@example.nomail', 'Ada')").run()
  sqlite.close()
}

/** A database at 0004 with a person and the given surcharge, then migrated to the latest version. */
function settingsAfter(percent: string | null) {
  const file = path.join(dir, `s${percent}.db`)
  const sqlite = openSqlite(file)
  runMigrations(createDb(sqlite), olderFolder(5))
  sqlite.prepare("INSERT INTO users (email, name) VALUES ('ada@example.nomail', 'Ada')").run()
  if (percent)
    sqlite.prepare("INSERT INTO settings (key, value) VALUES ('holiday_work_surcharge_percent', ?)").run(percent)
  sqlite.prepare("INSERT INTO holiday_calendars (name, region_code) VALUES ('CH-FR City of Fribourg', 'CH-FR')").run()
  runMigrations(createDb(sqlite))
  const rows = sqlite.prepare("SELECT key, value FROM settings ORDER BY key").all()
  const cal = sqlite.prepare("SELECT region_code AS r FROM holiday_calendars").get()
  sqlite.close()
  return { rows, cal }
}

describe("rt migrate", () => {
  it("backs up a used database before applying pending migrations", async () => {
    const file = path.join(dir, "rt.db")
    olderDatabase(file, true)
    expect(await migrateDatabase({ file, check: true, log })).toBe(1)
    expect(lines.at(-1)).toMatch(
      /^pending: 0002_passkeys, 0003_guards_v2, 0004_arg_exempt, 0005_regular_night_work, 0006_scheduled_clock_out$/,
    )
    expect(await migrateDatabase({ file, log })).toBe(0)
    const backups = readdirSync(path.join(dir, "backups"))
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/-premigrate\.zip\.enc$/)
    expect(lines.some((l) => l.startsWith("applying 5 migration(s)"))).toBe(true)
    expect(migrationStatus(rawSqlite()).pending).toEqual([])
    // a user exists: no setup code
    expect(lines.join("\n")).not.toContain("first-run setup")
    rawSqlite().close()
    lines = []
    expect(await migrateDatabase({ file, check: true, log })).toBe(0)
    expect(lines).toEqual(["up to date"])
  })

  it("migrates a new database without a backup and prints the setup code", async () => {
    const file = path.join(dir, "new.db")
    expect(await migrateDatabase({ file, log })).toBe(0)
    expect(existsSync(path.join(dir, "backups"))).toBe(false)
    const out = lines.join("\n").split("\n")
    const at = out.findIndex((l) => l.includes("first-run setup"))
    expect(at).toBeGreaterThan(0)
    expect(out.slice(at, at + 5).join("\n")).toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)
  })

  it("keeps the holiday surcharge of existing installs and the Fribourg preset key", () => {
    expect(settingsAfter("25").rows).toEqual([
      { key: "holiday_work_surcharge_mode", value: '"time_credit"' },
      { key: "holiday_work_surcharge_percent", value: "25" },
    ])
    const none = settingsAfter(null)
    expect(none.rows).toEqual([{ key: "holiday_work_surcharge_percent", value: "0" }])
    expect(none.cal).toEqual({ r: "ch-fr-fribourg" })
  })

  it("retires break entries with a revision each, except in signed-off months", () => {
    const sqlite = openSqlite(path.join(dir, "breaks.db"))
    runMigrations(createDb(sqlite), olderFolder(6))
    sqlite.prepare("INSERT INTO users (id, email, name) VALUES (1, 'ada@example.nomail', 'Ada')").run()
    const entry = sqlite.prepare("INSERT INTO time_entries (user_id, kind, start_at, end_at) VALUES (1, ?, ?, ?)")
    entry.run("break", "2026-10-02T10:00:00.000000Z", "2026-10-02T10:30:00.000000Z")
    entry.run("work", "2026-11-03T07:00:00.000000Z", "2026-11-03T11:00:00.000000Z")
    entry.run("break", "2026-11-03T11:00:00.000000Z", "2026-11-03T11:45:30.123456Z")
    entry.run("break", "2026-11-04T11:00:00.000000Z", null)
    sqlite
      .prepare(
        "INSERT INTO month_signoffs (user_id, month, period_start_date, period_end_date, period_start_utc, period_end_utc, digest, seal) VALUES (1, '2026-10', '2026-10-01', '2026-10-31', '2026-09-30T22:00:00.000000Z', '2026-10-31T23:00:00.000000Z', 'd', 's')",
      )
      .run()
    runMigrations(createDb(sqlite))
    const rows = sqlite.prepare("SELECT id, kind, is_deleted AS d, end_at IS NOT NULL AS ended FROM time_entries").all()
    expect(rows).toEqual([
      { id: 1, kind: "break", d: 0, ended: 1 },
      { id: 2, kind: "work", d: 0, ended: 1 },
      { id: 3, kind: "break", d: 1, ended: 1 },
      { id: 4, kind: "break", d: 1, ended: 1 },
    ])
    const revs = sqlite
      .prepare<[], { entity_id: number; action: string; source: string; before: string; after: string }>(
        "SELECT entity_id, action, source, before, after FROM revisions ORDER BY entity_id",
      )
      .all()
    expect(revs.map((r) => [r.entity_id, r.action, r.source])).toEqual([
      [3, "delete", "migration"],
      [4, "delete", "migration"],
    ])
    expect(JSON.parse(revs[0].before)).toMatchObject({ end_at: "2026-11-03T11:45:30.123Z", is_deleted: false })
    expect(JSON.parse(revs[0].after)).toMatchObject({ is_deleted: true, scheduled_end_at: null })
    expect(JSON.parse(revs[1].before).end_at).toBeNull()
    expect(JSON.parse(revs[1].after).end_at).toMatch(/Z$/)
    sqlite.close()
  })

  it("migration 0006 runs the same statements as retireLegacyBreaks", () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, "0006_scheduled_clock_out.sql"), "utf8")
    for (const statement of RETIRE_LEGACY_BREAKS) expect(sql).toContain(statement)
  })

  it("skips the backup on request", async () => {
    const file = path.join(dir, "rt.db")
    olderDatabase(file, true)
    expect(await migrateDatabase({ file, backup: false, log })).toBe(0)
    expect(existsSync(path.join(dir, "backups"))).toBe(false)
  })

  it("leaves a RESORIXtrack 1.x database byte-identical", async () => {
    const file = path.join(dir, "v1.db")
    const v1 = new Database(file)
    v1.exec("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)")
    v1.exec("INSERT INTO alembic_version VALUES ('0007')")
    v1.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)")
    v1.close()
    const before = sha(file)
    await expect(migrateDatabase({ file, log })).rejects.toThrow(/1\.x database.*rt import-v1 --data/)
    await expect(migrateDatabase({ file, check: true, log })).rejects.toBeInstanceOf(DatabaseVersionError)
    expect(sha(file)).toBe(before)
    expect(readdirSync(dir).sort()).toEqual(["v1.db"])
  })

  it("refuses a database migrated by a newer version without changing it", async () => {
    const file = path.join(dir, "rt.db")
    const sqlite = openSqlite(file)
    runMigrations(createDb(sqlite))
    sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 4102444800000)").run()
    sqlite.pragma("wal_checkpoint(TRUNCATE)")
    sqlite.close()
    const before = sha(file)
    await expect(migrateDatabase({ file, log })).rejects.toThrow(/newer RESORIXtrack/)
    expect(sha(file)).toBe(before)
  })
})
