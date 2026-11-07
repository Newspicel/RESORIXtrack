import { beforeEach, describe, expect, it } from "vitest"
import { rawSqlite } from "@/server/db"
import { freeze } from "@/server/time"
import { loadActor, lockMonth, makeEntry, makeSchedule, makeUser } from "@/test/factories"
import { clockAction, clockState, openEntry, stopRunning, syncOffline } from "./clock"
import { listEntries } from "./entries"

const NOW = Date.parse("2026-11-05T14:00:00Z") // Thu 15:00 Zurich
const TODAY = "2026-11-05"
const t = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
const setNow = (minutes: number) => freeze(t(minutes))

function anna() {
  const u = makeUser({ name: "Anna A" })
  makeSchedule(u.id)
  return loadActor(u.id)
}

beforeEach(() => setNow(0))

describe("clock", () => {
  it("runs the state machine idempotently", () => {
    const A = anna()
    expect(clockState(A.user).state).toBe("idle")
    expect(() => clockAction(A, "break")).toThrow(expect.objectContaining({ code: "not_working" }))
    expect(() => clockAction(A, "resume")).toThrow(expect.objectContaining({ code: "not_on_break" }))
    expect(clockAction(A, "start").state).toBe("working")
    expect(clockAction(A, "start").state).toBe("working")
    setNow(60)
    expect(clockAction(A, "break").state).toBe("on_break")
    setNow(90)
    expect(clockAction(A, "resume").state).toBe("working")
    setNow(120)
    const s = clockAction(A, "stop")
    expect(s).toMatchObject({ state: "idle", todayWorkedMin: 90, todayBreakMin: 30 })
    const entries = listEntries(A, A.id, TODAY, TODAY)
    expect(entries.map((e) => e.kind)).toEqual(["work", "break", "work"])
    expect(entries.every((e) => e.source === "clock")).toBe(true)
    expect(clockAction(A, "stop").state).toBe("idle")
  })

  it("accepts backdated times within limits", () => {
    const A = anna()
    expect(clockAction(A, "start", { at: t(-20) }).since).toMatch(/^2026-11-05T13:40/)
    expect(() => clockAction(A, "stop", { at: t(60) })).toThrow(expect.objectContaining({ fields: { at: "future" } }))
    expect(() => clockAction(A, "stop", { at: t(-3 * 24 * 60) })).toThrow(
      expect.objectContaining({ fields: { at: "too_old" } }),
    )
    expect(() => clockAction(A, "stop", { at: t(-30) })).toThrow(expect.objectContaining({ code: "clock_order" }))
  })

  it("custom times mark the entry as manual; overlaps are refused", () => {
    const A = anna()
    expect(clockAction(A, "start", { at: t(-120), custom: true }).state).toBe("working")
    expect(openEntry(A.id)?.source).toBe("manual")
    clockAction(A, "stop")
    expect(() => clockAction(A, "start", { at: t(-60), custom: true })).toThrow(
      expect.objectContaining({ code: "overlap" }),
    )
    expect(() => clockAction(A, "start", { at: t(60), custom: true })).toThrow(
      expect.objectContaining({ fields: { at: "future" } }),
    )

    setNow(10)
    clockAction(A, "start")
    setNow(40)
    clockAction(A, "stop", { at: t(30), custom: true })
    const last = listEntries(A, A.id, TODAY, TODAY).at(-1)!
    expect(last).toMatchObject({ source: "manual", endAt: new Date(NOW + 30 * 60_000).toISOString() })
    setNow(50)
    clockAction(A, "start")
    setNow(55)
    clockAction(A, "stop")
    expect(listEntries(A, A.id, TODAY, TODAY).at(-1)!.source).toBe("clock")
  })

  it("rapid clicks within one second keep entries apart and editable", () => {
    const A = anna()
    for (const [action, state] of [
      ["start", "working"],
      ["break", "on_break"],
      ["resume", "working"],
      ["stop", "idle"],
    ] as const) {
      expect(clockAction(A, action).state).toBe(state)
    }
    const entries = listEntries(A, A.id, TODAY, TODAY)
    expect(entries.map((e) => e.kind)).toEqual(["work", "break", "work"])
    for (let i = 1; i < entries.length; i++) expect(entries[i - 1].endAt! <= entries[i].startAt).toBe(true)
    expect(entries.every((e) => e.endAt! > e.startAt)).toBe(true)
    expect(clockAction(A, "start").state).toBe("working")
  })

  it("refuses outside employment and in signed-off months", () => {
    const u = makeUser({ employmentEnd: "2026-10-31" })
    expect(() => clockAction(loadActor(u.id), "start")).toThrow(expect.objectContaining({ code: "employment_ended" }))
    const v = makeUser({ employmentStart: "2026-12-01" })
    expect(() => clockAction(loadActor(v.id), "start")).toThrow(expect.objectContaining({ code: "not_employed" }))
    const A = anna()
    lockMonth(A.id, "2026-11")
    expect(() => clockAction(A, "start")).toThrow(expect.objectContaining({ code: "period_signed_off" }))
  })

  it("one open entry per person: the database index wins a race", () => {
    const A = anna()
    makeEntry(A.id, "2026-11-05T07:00:00.000000Z", null, { source: "clock" })
    expect(() =>
      rawSqlite()
        .prepare("INSERT INTO time_entries (user_id, kind, start_at, source) VALUES (?, 'work', ?, 'clock')")
        .run(A.id, "2026-11-05T13:00:00.000000Z"),
    ).toThrow(/UNIQUE/)
    rawSqlite().prepare("UPDATE time_entries SET end_at = ? WHERE user_id = ?").run("2026-11-05T08:00:00.000000Z", A.id)
    // simulate a concurrent clock-in committing between our read ("idle") and our insert
    rawSqlite().exec(
      "CREATE TEMP TRIGGER race BEFORE INSERT ON time_entries WHEN NEW.note = 'race' BEGIN INSERT INTO time_entries (user_id, kind, start_at, source) VALUES (NEW.user_id, 'work', NEW.start_at, 'clock'); END",
    )
    expect(() => clockAction(A, "start", { note: "race" })).toThrow(
      expect.objectContaining({ code: "already_running" }),
    )
    rawSqlite().exec("DROP TRIGGER race")
  })

  it("stopRunning closes a running entry (deactivation)", () => {
    const A = anna()
    clockAction(A, "start", { at: t(-60) })
    expect(stopRunning(A.user, null, "deactivated")?.endAt).toBe("2026-11-05T14:00:00.000000Z")
    expect(clockState(A.user).state).toBe("idle")
    expect(stopRunning(A.user, null)).toBeNull()
  })
})

describe("offline sync", () => {
  it("applies queued actions once, marks them offline and reports rejects", () => {
    const A = anna()
    const actions = [
      { id: "a1", action: "start" as const, at: t(-90) },
      { id: "a2", action: "break" as const, at: t(-60) },
      { id: "a3", action: "resume" as const, at: t(-45) },
      { id: "a4", action: "stop" as const, at: t(-10) },
    ]
    const first = syncOffline(A, actions)
    expect(first.results.map((r) => r.status)).toEqual(["applied", "applied", "applied", "applied"])
    expect(first.clock.state).toBe("idle")
    const entries = listEntries(A, A.id, TODAY, TODAY)
    expect(entries.map((e) => [e.kind, e.source])).toEqual([
      ["work", "offline"],
      ["break", "offline"],
      ["work", "offline"],
    ])
    const again = syncOffline(A, [...actions, { id: "a5", action: "stop", at: t(-5) }])
    expect(again.results.map((r) => r.status)).toEqual(["duplicate", "duplicate", "duplicate", "duplicate", "applied"])
    expect(listEntries(A, A.id, TODAY, TODAY)).toHaveLength(3)

    const bad = syncOffline(A, [{ id: "b1", action: "start", at: t(-30) }])
    expect(bad.results[0]).toEqual({ id: "b1", status: "rejected", code: "overlap" })
    expect(syncOffline(A, [{ id: "b1", action: "start", at: t(-1) }]).results[0].status).toBe("duplicate")
    const revs = rawSqlite().prepare("SELECT DISTINCT source FROM revisions WHERE entity = 'time_entry'").all()
    expect(revs).toEqual([{ source: "offline" }])
  })

  it("keeps ids per person", () => {
    const A = anna()
    const B = anna()
    expect(syncOffline(A, [{ id: "x", action: "start", at: t(-5) }]).results[0].status).toBe("applied")
    expect(syncOffline(B, [{ id: "x", action: "start", at: t(-5) }]).results[0].status).toBe("applied")
  })
})
