import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { db, rawSqlite } from "@/server/db"
import * as s from "@/server/db/schema"
import { env } from "@/server/env"
import { createCalendarFromPreset } from "@/server/services/holiday-calendars"
import { clearMailOutbox, mailOutbox } from "@/server/services/mail"
import { loadActor } from "@/server/services/permissions"
import { signOff } from "@/server/services/signoffs"
import { freeze } from "@/server/time"
import { lockMonth, makeEntry, makeOrg, withSettings } from "@/test/factories"
import { holidayTopUp, integrityCheck, JOBS, nightlyBackup, retentionCleanup, sendClockReminders } from "./jobs"

const notes = (userId: number, kind: string) =>
  db
    .select()
    .from(s.notifications)
    .where(eq(s.notifications.userId, userId))
    .all()
    .filter((n) => n.kind === kind)

describe("job table", () => {
  it("schedules every job with a valid cron expression", () => {
    expect(JOBS.map((j) => j.name)).toEqual(["backup", "clock-reminders", "cleanup", "integrity", "holiday-top-up"])
    for (const j of JOBS) expect(j.schedule.split(" ")).toHaveLength(5)
  })
})

describe("nightly backup", () => {
  let dir: string
  const saved = { ...env }
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "rt-jobs-"))
    Object.assign(env, {
      dataDir: dir,
      backupsDir: path.join(dir, "backups"),
      attachmentsDir: path.join(dir, "attachments"),
      brandingDir: path.join(dir, "branding"),
      backupPassword: "test-backup-password",
      backupKeep: 2,
    })
  })
  afterEach(() => {
    Object.assign(env, saved)
    rmSync(dir, { recursive: true, force: true })
  })

  it("writes an encrypted automatic backup and keeps the newest BACKUP_KEEP automatic ones", async () => {
    mkdirSync(env.backupsDir, { recursive: true })
    for (const name of [
      "resorixtrack-20200101-020000-auto.zip.enc",
      "resorixtrack-20200102-020000-auto.zip.enc",
      "resorixtrack-20200103-020000-manual.zip.enc",
    ])
      writeFileSync(path.join(env.backupsDir, name), "x")
    const r = await nightlyBackup()
    expect(r.name).toMatch(/^resorixtrack-\d{8}-\d{6}-auto\.zip\.enc$/)
    expect(r.removed).toBe(1)
    expect(readdirSync(env.backupsDir).sort()).toEqual(
      [r.name, "resorixtrack-20200102-020000-auto.zip.enc", "resorixtrack-20200103-020000-manual.zip.enc"].sort(),
    )
  })
})

describe("clock reminders", () => {
  beforeEach(() => clearMailOutbox())

  it("reminds once per entry running longer than the setting, by notification and email", () => {
    const org = makeOrg() // now: 2026-11-05 08:00 UTC
    const long = makeEntry(org.anna.id, "2026-11-04T21:00:00Z", null)
    makeEntry(org.ben.id, "2026-11-05T01:00:00Z", null) // 7 h: not yet
    makeEntry(org.carl.id, "2026-11-04T08:00:00Z", "2026-11-04T17:00:00Z") // finished
    expect(sendClockReminders()).toBe(1)
    expect(sendClockReminders()).toBe(0)
    const n = notes(org.anna.id, "clock_reminder")
    expect(n).toHaveLength(1)
    expect(n[0].payload).toMatchObject({ entry_id: long.id, hours: 10, since: "2026-11-04T21:00:00.000Z" })
    expect(mailOutbox().map((m) => m.to)).toEqual([org.anna.email])
    expect(notes(org.ben.id, "clock_reminder")).toHaveLength(0)

    // a new running entry later gets its own reminder
    db.update(s.timeEntries).set({ endAt: "2026-11-05T07:00:00.000000Z" }).where(eq(s.timeEntries.id, long.id)).run()
    makeEntry(org.anna.id, "2026-11-05T07:00:00Z", null)
    freeze("2026-11-05T18:00:00Z")
    expect(sendClockReminders()).toBe(2) // Anna's new entry and Ben's
    expect(notes(org.anna.id, "clock_reminder")).toHaveLength(2)
  })

  it("is off with 0 hours and skips inactive people", () => {
    const org = makeOrg()
    makeEntry(org.anna.id, "2026-11-04T08:00:00Z", null)
    makeEntry(org.ben.id, "2026-11-04T08:00:00Z", null)
    db.update(s.users).set({ isActive: false }).where(eq(s.users.id, org.ben.id)).run()
    withSettings({ clock_reminder_hours: 0 })
    expect(sendClockReminders()).toBe(0)
    withSettings({ clock_reminder_hours: 10 })
    expect(sendClockReminders()).toBe(1)
  })
})

describe("retention cleanup", () => {
  it("removes expired or old security data and keeps everything recent", () => {
    const org = makeOrg() // now: 2026-11-05
    const old = "2025-01-01T00:00:00.000000Z"
    const recent = "2026-11-01T00:00:00.000000Z"
    db.insert(s.loginAttempts)
      .values([
        { email: "a@example.nomail", at: old },
        { email: "b@example.nomail", at: recent },
      ])
      .run()
    db.insert(s.notifications)
      .values([
        { userId: org.anna.id, kind: "x", readAt: old, createdAt: old },
        { userId: org.anna.id, kind: "unread", createdAt: old },
        { userId: org.anna.id, kind: "recent", readAt: recent, createdAt: recent },
      ])
      .run()
    const past = new Date(Date.parse("2026-11-01T00:00:00Z"))
    const future = new Date(Date.parse("2026-12-01T00:00:00Z"))
    db.insert(s.session)
      .values([
        { token: "t1", userId: org.anna.id, expiresAt: past, updatedAt: past },
        { token: "t2", userId: org.anna.id, expiresAt: future, updatedAt: past },
      ])
      .run()
    db.insert(s.verification)
      .values([
        { identifier: "v1", value: "1", expiresAt: past },
        { identifier: "v2", value: "2", expiresAt: future },
      ])
      .run()
    db.insert(s.authTokens)
      .values([
        { userId: org.anna.id, purpose: "invite", tokenHash: "h1", expiresAt: old, createdAt: old },
        {
          userId: org.anna.id,
          purpose: "invite",
          tokenHash: "h2",
          expiresAt: "2026-11-20T00:00:00.000000Z",
          createdAt: old,
        },
      ])
      .run()
    db.insert(s.appState)
      .values([
        { key: `offline:${org.anna.id}:old`, value: "{}", updatedAt: old },
        { key: `offline:${org.anna.id}:new`, value: "{}", updatedAt: recent },
        { key: "worker_heartbeat", value: "x", updatedAt: old },
      ])
      .run()
    const entry = makeEntry(org.anna.id, "2020-01-06T08:00:00Z", "2020-01-06T12:00:00Z")

    expect(retentionCleanup()).toEqual({
      loginAttempts: 1,
      notifications: 1,
      sessions: 1,
      verifications: 1,
      authTokens: 1,
      apiKeys: 0,
      offlineActions: 1,
    })
    expect(
      db
        .select()
        .from(s.loginAttempts)
        .all()
        .map((r) => r.email),
    ).toEqual(["b@example.nomail"])
    expect(
      db
        .select()
        .from(s.notifications)
        .all()
        .map((r) => r.kind)
        .sort(),
    ).toEqual(["recent", "unread"])
    expect(
      db
        .select()
        .from(s.appState)
        .all()
        .map((r) => r.key)
        .sort(),
    ).toEqual([`offline:${org.anna.id}:new`, "worker_heartbeat"].sort())
    expect(db.select().from(s.timeEntries).where(eq(s.timeEntries.id, entry.id)).get()).toBeTruthy()
    expect(retentionCleanup().loginAttempts).toBe(0)
  })
})

describe("holiday top-up", () => {
  afterEach(() => freeze(null))

  it("runs at worker start and on 1 October, adding next year to preset calendars", () => {
    expect(JOBS.find((j) => j.name === "holiday-top-up")).toMatchObject({ atStart: true, schedule: "0 5 1 10,11 *" })
    makeOrg()
    const cal = createCalendarFromPreset("CH-ZH", { years: [2026] })
    freeze("2026-10-01T05:00:00Z")
    expect(holidayTopUp().topped).toEqual([{ calendarId: cal.id, year: 2027, added: 9 }])
    expect(holidayTopUp().topped).toEqual([])
  })
})

describe("integrity check", () => {
  it("passes for intact chains and reports broken seals and missing guards to HR and admins", () => {
    const org = makeOrg()
    makeEntry(org.anna.id, "2026-10-05T07:00:00Z", "2026-10-05T15:00:00Z")
    signOff(loadActor(org.hr!.id), org.anna, "2026-10")
    let r = integrityCheck()
    expect(r).toMatchObject({ checked: 1, problems: [], missingGuards: [] })
    expect(notes(org.hr!.id, "integrity_problem")).toHaveLength(0)

    const forged = lockMonth(org.ben.id, "2026-09") // a row whose seal was never computed
    r = integrityCheck()
    expect(r.problems).toEqual([{ id: forged.id, status: expect.not.stringMatching(/^intact$/) }])
    for (const id of [org.hr!.id, org.admin.id]) expect(notes(id, "integrity_problem")).toHaveLength(1)
    expect(notes(org.anna.id, "integrity_problem")).toHaveLength(0)

    const guard = firstGuard()
    rawSqlite().exec(`DROP TRIGGER ${guard}`)
    expect(integrityCheck().missingGuards).toEqual([guard])
  })
})

function firstGuard(): string {
  const row = rawSqlite().prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' LIMIT 1").get() as {
    name: string
  }
  return row.name
}
