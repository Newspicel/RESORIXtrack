import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { db, rawSqlite } from "@/server/db"
import * as s from "@/server/db/schema"
import { computeDigest, computeSeal, PyFloat, sealKey } from "@/server/services/seals"
import { makeUser } from "@/test/factories"
import { formatReport, ImportError, importV1 } from "."
import { V1_MIGRATION_0002, V1_SCHEMA_0001 } from "./v1-schema.fixture"

const KEY = "v1-test-signoff-key"
const TS = "2026-01-05 08:00:00.123456"
const HASH = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g"
const PDF = Buffer.from("%PDF-1.4\n% certificate\n%%EOF\n")
const SNAPSHOT =
  '{"target_min": 11088.0, "worked_min": 240.0, "user_name": "J\\u00fcrg Z\\u00fcrcher", "signed_by_name": "Lea"}'

let dir: string
let v1: Database.Database

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rt-import-v1-"))
  mkdirSync(path.join(dir, "v1", "attachments"), { recursive: true })
  mkdirSync(path.join(dir, "v1", "branding"), { recursive: true })
  writeFileSync(path.join(dir, "v1", "attachments", "abc123"), PDF)
  writeFileSync(path.join(dir, "v1", "branding", "logo-light.svg"), "<svg/>")
  writeFileSync(path.join(dir, "v1", "branding", "notes.txt"), "not a logo")
  v1 = buildV1("0002")
})
afterEach(() => {
  v1.close()
  rmSync(dir, { recursive: true, force: true })
})

function insert(d: Database.Database, table: string, rows: unknown[][]) {
  for (const r of rows) d.prepare(`INSERT INTO ${table} VALUES (${r.map(() => "?").join(", ")})`).run(r)
}

/** A small v1 database built from the v1 schema SQL, with one signed-off month carrying a valid v1 seal. */
function buildV1(revision: "0001" | "0002", opts: { signoffKey?: string } = {}): Database.Database {
  const d = new Database(":memory:")
  d.exec(V1_SCHEMA_0001)
  if (revision === "0002") d.exec(V1_MIGRATION_0002)
  insert(d, "alembic_version", [[revision]])
  insert(d, "holiday_calendars", [[1, "CH-FR", "CH-FR", "", 1, TS]])
  insert(d, "holidays", [
    [1, 1, "2026-08-01", "National Day", 1.0],
    [2, 1, "2026-12-24", "Christmas Eve", 0.5],
  ])
  insert(d, "teams", [[5, "RF", "#35a1cc", 1, "2026-01-05 08:00:00"]])
  const user = (
    id: number,
    email: string,
    name: string,
    extra: { pw?: boolean; totp?: boolean; role?: string; caps?: string | null } = {},
  ) => [
    id,
    email,
    name,
    extra.role ?? "employee",
    5,
    null,
    "Europe/Zurich",
    "de",
    "2026-01-01",
    null,
    25.0,
    extra.pw === false ? null : HASH,
    extra.pw === false ? null : TS,
    extra.totp ? "enc" : null,
    extra.totp ? TS : null,
    extra.totp ? '["x"]' : null,
    null,
    1,
    1,
    extra.caps === undefined ? "[]" : extra.caps,
    TS,
    null,
    ...(revision === "0002" ? ["12h"] : []),
  ]
  insert(d, "users", [
    user(10, "hr@example.nomail", "Hanna HR", { role: "admin", caps: '["hr", "projects"]' }),
    user(11, "lea@example.nomail", "Lea Lead", { caps: null }),
    user(12, "jurg@example.nomail", "Jürg Zürcher", { totp: true }),
    user(13, "new@example.nomail", "New Hire", { pw: false }),
    user(14, "anonymised-14@invalid.local", "Former employee #14", { pw: false }),
  ])
  d.prepare("UPDATE users SET is_active = 0 WHERE id = 14").run()
  insert(d, "team_leads", [[1, 5, 11, "lead", null, null, 10, TS]])
  insert(d, "work_schedules", [[1, 12, "2026-01-01", 100.0, 504, 504, 504, 504, 504, 0, 0, TS]])
  insert(d, "absence_types", [
    [1, "vacation", "Vacation", "#35a1cc", "vacation", 1, 1, 1, 0, 1, 1, 0],
    [2, "sick", "Sick", "#e0a23b", "sick", 1, 0, 0, 1, 1, 1, 10],
  ])
  insert(d, "projects", [[3, "Internal", "INT", "#62656b", "", null, 1, 10, TS, TS]])
  insert(d, "time_entries", [
    [
      100,
      12,
      "work",
      "2026-09-01 06:30:00.000000",
      "2026-09-01 10:30:00.123456",
      "Europe/Zurich",
      "",
      "clock",
      0,
      12,
      TS,
      TS,
    ],
    [
      101,
      12,
      "break",
      "2026-09-01 10:30:00.123456",
      "2026-09-01 11:00:00",
      "Europe/Zurich",
      "Lunch",
      "clock",
      0,
      12,
      TS,
      TS,
    ],
    [102, 12, "work", "2026-11-05 07:00:00.000000", null, "Europe/Zurich", "", "clock", 0, 12, TS, TS],
  ])
  insert(d, "absences", [
    [7, 12, 2, "2026-09-10", "2026-09-10", "full", "full", "Flu", "approved", 12, 11, TS, "", null, null, "", TS, TS],
  ])
  const sha = createHash("sha256").update(PDF).digest("hex")
  insert(d, "attachments", [
    [1, 7, "cert.pdf", "application/pdf", PDF.length, sha, "abc123", 12, 0, TS],
    [2, 7, "old.pdf", "application/pdf", 0, sha, "purged1", 12, 1, TS],
  ])
  insert(d, "vacation_entitlements", [[1, 12, 2026, 27.0, "Long service"]])
  insert(d, "balance_adjustments", [[1, 12, "time", 90.0, "2026-09-15", "correction", "Travel", 0, 11, TS]])
  insert(d, "work_logs", [
    [1, 12, "2026-09-01", 3, 240, "08:30:00.000000", "12:30:00.000000", "C-1", "Review", 12, 0, TS, TS],
  ])
  insert(d, "notifications", [[1, 12, "month_signed_off", '{"month": "2026-09"}', null, TS]])
  insert(d, "revisions", [
    [
      1,
      "time_entry",
      100,
      12,
      12,
      "create",
      "null",
      '{"kind": "work", "start_at": "2026-09-01T06:30:00+00:00"}',
      "",
      "web",
      TS,
    ],
    [2, "user", 14, 14, 10, "anonymize", null, null, "", "web", "2026-10-01 09:00:00.5"],
  ])
  insert(d, "settings", [
    ["company_name", '"ACME AG"'],
    ["holiday_mode", '"prorata"'],
    ["default_vacation_days", "25.0"], // v1 JSON columns have NUMERIC affinity: this comes back as a number
    ["legacy_flag", "true"],
    ["session_remember_days", "14"], // retired: SESSION_REMEMBER_DAYS
    ["break_rules_enabled", "false"], // retired: breaks are always checked when the ArG applies
  ])
  insert(d, "login_attempts", [[1, "jurg@example.nomail", 12, "127.0.0.1", "UA", 1, "ok", TS]])
  insert(d, "user_sessions", [[1, 12, "h1", "c1", 1, "UA", "127.0.0.1", TS, TS, "2099-01-01 00:00:00", null]])
  insert(d, "api_tokens", [
    [1, 11, "Desktop", "rt_abc", "h2", "time:read", null, "", "", 0, "2099-01-01 00:00:00", null, null, TS],
  ])
  insert(d, "auth_tokens", [[1, 13, "invite", "h3", "2099-01-01 00:00:00", null, TS]])

  // the v1 sign-off of September for Jürg, sealed like v1 services/signoffs.py does
  const digest = computeDigest(1, {
    work_logs: [[1, "2026-09-01", 3, "C-1", 240, "Review", false, "08:30", "12:30"]],
    entries: [
      [100, "work", "2026-09-01T06:30:00.000000", "2026-09-01T10:30:00.123456", false, ""],
      [101, "break", "2026-09-01T10:30:00.123456", "2026-09-01T11:00:00.000000", false, "Lunch"],
    ],
    absences: [[7, 2, "2026-09-10", "2026-09-10", "full", "full", "approved"]],
    adjustments: [[1, "time", new PyFloat(90), "2026-09-15", false]],
  })
  const row = {
    userId: 12,
    month: "2026-09",
    periodStartDate: "2026-09-01",
    periodEndDate: "2026-09-30",
    periodStartUtc: "2026-08-31T22:00:00.000000Z",
    periodEndUtc: "2026-09-30T22:00:00.000000Z",
    signedById: 11,
    signedAt: "2026-10-02T08:00:00.000000Z",
    snapshot: SNAPSHOT,
    digest,
    prevSeal: "",
    sealVersion: 1,
  }
  const seal = computeSeal(row, sealKey(opts.signoffKey ?? KEY))
  insert(d, "month_signoffs", [
    [
      1,
      12,
      "2026-09",
      "2026-09-01",
      "2026-09-30",
      "2026-08-31 22:00:00.000000",
      "2026-09-30 22:00:00.000000",
      11,
      "2026-10-02 08:00:00.000000",
      "ok",
      SNAPSHOT,
      digest,
      "",
      seal,
      null,
      null,
      "",
    ],
  ])
  return d
}

const run = (src = v1, opts: Partial<Parameters<typeof importV1>[2]> = {}) =>
  importV1(src, rawSqlite(), {
    sourceDataDir: path.join(dir, "v1"),
    targetDataDir: path.join(dir, "v2"),
    signoffKey: KEY,
    ...opts,
  })

const total = (table: string) =>
  rawSqlite().prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0

describe("import-v1", () => {
  it("copies every table with ids kept and formats converted", () => {
    const report = run()
    for (const t of report.tables) {
      if (t.table === "settings") expect([t.v1, t.v2]).toEqual([6, 3])
      else expect(t.v2, t.table).toBe(t.v1)
    }
    expect(report.tables.length).toBe(19)

    const entry = db.select().from(s.timeEntries).where(eq(s.timeEntries.id, 101)).get()!
    expect(entry).toMatchObject({
      userId: 12,
      kind: "break",
      startAt: "2026-09-01T10:30:00.123456Z",
      endAt: "2026-09-01T11:00:00.000000Z",
      note: "Lunch",
    })
    expect(entry.createdAt).toBe("2026-01-05T08:00:00.123456Z")
    expect(db.select().from(s.timeEntries).where(eq(s.timeEntries.id, 102)).get()!.endAt).toBeNull()
    expect(db.select().from(s.teams).get()!.createdAt).toBe("2026-01-05T08:00:00.000000Z")
    expect(db.select().from(s.workLogs).get()).toMatchObject({
      id: 1,
      projectId: 3,
      startTime: "08:30",
      endTime: "12:30",
      minutes: 240,
    })
    expect(db.select().from(s.absences).get()).toMatchObject({
      id: 7,
      typeId: 2,
      decidedAt: "2026-01-05T08:00:00.123456Z",
      cancelledAt: null,
    })
    expect(
      db
        .select()
        .from(s.holidays)
        .all()
        .map((h) => [h.date, h.fraction]),
    ).toEqual([
      ["2026-08-01", 1],
      ["2026-12-24", 0.5],
    ])

    const revs = db.select().from(s.revisions).all()
    expect(revs[0]).toMatchObject({
      id: 1,
      before: null,
      after: { kind: "work", start_at: "2026-09-01T06:30:00+00:00" },
      at: "2026-01-05T08:00:00.123456Z",
    })
    expect(revs[1].at).toBe("2026-10-01T09:00:00.500000Z")
    expect(db.select().from(s.notifications).get()!.payload).toEqual({ month: "2026-09" })
    expect(
      db
        .select()
        .from(s.settings)
        .all()
        .map((r) => [r.key, r.value]),
    ).toEqual([
      ["company_name", "ACME AG"],
      ["holiday_mode", "prorata"],
      ["default_vacation_days", 25],
      ["holiday_work_surcharge_percent", 0], // v1's default, not v2's 50 %
    ])
    expect(report.settingsSkipped).toEqual(["legacy_flag"])
  })

  it("maps people to Better Auth users and credential accounts", () => {
    const report = run()
    const jurg = db.select().from(s.users).where(eq(s.users.id, 12)).get()!
    expect(jurg).toMatchObject({
      email: "jurg@example.nomail",
      teamId: 5,
      emailVerified: true,
      twoFactorEnabled: false,
      mfaReenrolRequired: true,
      timeFormat: "12h",
      capabilities: [],
    })
    expect(jurg.createdAt).toEqual(new Date("2026-01-05T08:00:00.123Z"))
    expect(jurg.updatedAt).toEqual(jurg.createdAt)
    expect(jurg.passwordChangedAt).toBe("2026-01-05T08:00:00.123456Z")
    expect(db.select().from(s.users).where(eq(s.users.id, 10)).get()!.capabilities).toEqual(["hr", "projects"])
    expect(db.select().from(s.users).where(eq(s.users.id, 11)).get()!).toMatchObject({
      capabilities: [],
      mfaReenrolRequired: false,
    })
    expect(db.select().from(s.users).where(eq(s.users.id, 14)).get()!).toMatchObject({
      anonymizedAt: "2026-10-01T09:00:00.500000Z",
      isActive: false,
    })

    const accounts = db.select().from(s.account).all()
    expect(accounts.map((a) => [a.userId, a.accountId, a.providerId, a.password])).toEqual([
      [10, "10", "credential", HASH],
      [11, "11", "credential", HASH],
      [12, "12", "credential", HASH],
    ])
    expect(report.credentials).toBe(3)
    expect(total("two_factor") + total("session") + total("apikey") + total("auth_tokens")).toBe(0)

    expect(report.people.invite.map((p) => p.id)).toEqual([13])
    expect(report.people.apiKeys).toEqual([{ id: 11, name: "Lea Lead", email: "lea@example.nomail", tokens: 1 }])
    expect(report.people.twoFactor.map((p) => p.id)).toEqual([12])
    expect(report.skipped.map((r) => [r.table, r.rows])).toEqual([
      ["user_sessions", 1],
      ["api_tokens", 1],
      ["auth_tokens", 1],
      ["alembic_version", 1],
    ])
  })

  it("inserts sign-offs last, byte-exact, and verifies their seals", () => {
    const report = run()
    const so = db.select().from(s.monthSignoffs).get()!
    expect(so).toMatchObject({
      id: 1,
      sealVersion: 1,
      snapshot: SNAPSHOT,
      prevSeal: "",
      periodStartUtc: "2026-08-31T22:00:00.000000Z",
      signedAt: "2026-10-02T08:00:00.000000Z",
    })
    expect(report.seals).toEqual({ people: 1, signoffs: 1, problems: [] })
    // the guards are live after the import: September is locked, also for holidays
    expect(() => rawSqlite().prepare("UPDATE time_entries SET note = 'x' WHERE id = 100").run()).toThrow(
      /period signed off/,
    )
    expect(() =>
      rawSqlite().prepare("INSERT INTO holidays (calendar_id, date, name) VALUES (1, '2026-09-20', 'x')").run(),
    ).toThrow(/period signed off/)
    expect(formatReport(report)).toContain("Seals: 1/1 sign-offs of 1 people verified")
  })

  it("verifies and copies attachments and logos", () => {
    const report = run()
    expect(report.attachments).toMatchObject({ files: 1, purged: 1, copied: 1, missing: [], mismatched: [] })
    expect(readFileSync(path.join(dir, "v2", "attachments", "abc123"))).toEqual(PDF)
    expect(report.branding).toEqual(["logo-light.svg"])
    expect(existsSync(path.join(dir, "v2", "branding", "logo-light.svg"))).toBe(true)
    expect(existsSync(path.join(dir, "v2", "branding", "notes.txt"))).toBe(false)
  })

  it("dry run copies no files", () => {
    const report = run(v1, { targetDataDir: null, dryRun: true })
    expect(report.attachments.copied).toBe(0)
    expect(existsSync(path.join(dir, "v2"))).toBe(false)
    expect(formatReport(report)).toContain("dry run")
  })

  it("supports Alembic revision 0001 (columns added later get v2 defaults)", () => {
    const old = buildV1("0001")
    const report = run(old)
    old.close()
    expect(report.revision).toBe("0001")
    expect(db.select().from(s.users).where(eq(s.users.id, 12)).get()!.timeFormat).toBe("24h")
  })

  it("keeps a v1 holiday surcharge as a time credit", () => {
    const src = buildV1("0002")
    insert(src, "settings", [["holiday_work_surcharge_percent", "25"]])
    run(src)
    src.close()
    const rows = Object.fromEntries(
      db
        .select()
        .from(s.settings)
        .all()
        .map((r) => [r.key, r.value]),
    )
    expect(rows).toMatchObject({ holiday_work_surcharge_percent: 25, holiday_work_surcharge_mode: "time_credit" })
  })

  it("refuses unknown revisions, non-v1 databases and used targets", () => {
    v1.prepare("UPDATE alembic_version SET version_num = '0099'").run()
    expect(() => run()).toThrow(/unsupported v1 schema revision 0099/)
    const empty = new Database(":memory:")
    expect(() => run(empty)).toThrow(/not a RESORIXtrack 1.x database/)
    empty.close()
    v1.prepare("UPDATE alembic_version SET version_num = '0002'").run()
    makeUser()
    expect(() => run()).toThrow(/already has people/)
  })

  it("rolls back everything when a seal does not verify, unless forced", () => {
    let err: unknown = null
    try {
      run(v1, { signoffKey: "wrong-key" })
    } catch (e) {
      err = e
    }
    if (!(err instanceof ImportError)) throw new Error("expected an ImportError")
    expect(err.report?.seals.problems).toEqual([
      { userId: 12, name: "Jürg Zürcher", signoffId: 1, month: "2026-09", status: "seal_mismatch" },
    ])
    for (const t of ["users", "account", "time_entries", "revisions", "month_signoffs", "holidays", "settings"])
      expect(total(t), t).toBe(0)
    expect(existsSync(path.join(dir, "v2"))).toBe(false)

    const forced = run(v1, { signoffKey: "wrong-key", force: true })
    expect(forced.seals.problems).toHaveLength(1)
    expect(total("month_signoffs")).toBe(1)
  })

  it("rolls back on dangling references in the v1 data", () => {
    v1.pragma("foreign_keys = OFF")
    insert(v1, "work_logs", [[2, 99, "2026-10-01", null, 60, null, null, "", "", null, 0, TS, TS]])
    expect(() => run()).toThrow(/dangling references.*work_logs/)
    expect(total("users") + total("work_logs") + total("account")).toBe(0)
  })

  it("rolls back on malformed timestamps", () => {
    v1.prepare("UPDATE time_entries SET start_at = 'yesterday' WHERE id = 101").run()
    expect(() => run()).toThrow(/time_entries #101: not a v1 timestamp/)
    expect(total("users")).toBe(0)
  })

  it("aborts before writing when an attachment file changed or is missing", () => {
    writeFileSync(path.join(dir, "v1", "attachments", "abc123"), "tampered")
    expect(() => run()).toThrow(/attachment file\(s\) missing or changed: #1 abc123/)
    rmSync(path.join(dir, "v1", "attachments", "abc123"))
    expect(() => run()).toThrow(/#1 abc123/)
    expect(total("users")).toBe(0)
  })
})
