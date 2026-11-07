import { beforeEach, describe, expect, it, vi } from "vitest"
import { rawSqlite } from "@/server/db"
import { freeze } from "@/server/time"
import {
  loadActor,
  lockMonth,
  makeAdmin,
  makeEntry,
  makeLead,
  makeSchedule,
  makeTeam,
  makeUser,
  withSettings,
} from "@/test/factories"
import {
  createEntry,
  deleteEntry,
  disputeEntry,
  entryHistory,
  getEntry,
  listEntries,
  parseInstantInput,
  restoreEntry,
  updateEntry,
  userHistory,
} from "./entries"
import { queueMail } from "./mail"
import { listNotifications } from "./notifications"
import { withOutbox } from "./outbox"

vi.mock("./mail", () => ({ queueMail: vi.fn() }))

const local = (day: string, hm: string) => `${day}T${hm}`
const TODAY = "2026-11-05"

function org() {
  const team = makeTeam()
  const other = makeTeam()
  const lead = makeUser({ name: "Lea Lead" })
  makeLead(team.id, lead.id)
  const anna = makeUser({ name: "Anna A", teamId: team.id })
  const ben = makeUser({ name: "Ben B", teamId: team.id })
  const carl = makeUser({ name: "Carl C", teamId: other.id })
  const hr = makeUser({ name: "Hanna HR", capabilities: ["hr"] })
  const admin = makeAdmin({ name: "Adam Admin" })
  for (const u of [anna, ben, carl]) makeSchedule(u.id)
  return { team, lead, anna, ben, carl, hr, admin }
}

beforeEach(() => {
  freeze("2026-11-05T14:00:00Z") // Thu 15:00 Zurich
  vi.mocked(queueMail).mockClear()
})

describe("manual entries", () => {
  it("parses local times in the owner's timezone and offsets as given", () => {
    expect(parseInstantInput("2026-11-05T08:00", "Europe/Zurich")).toBe("2026-11-05T07:00:00.000000Z")
    expect(parseInstantInput("2026-11-05T08:00:00Z", "Europe/Zurich")).toBe("2026-11-05T08:00:00.000000Z")
    expect(() => parseInstantInput("nope", "Europe/Zurich")).toThrow(
      expect.objectContaining({ code: "validation_error" }),
    )
  })

  it("today needs no reason, past days do (setting), stored in UTC", () => {
    const { anna } = org()
    const A = loadActor(anna.id)
    const e = createEntry(A, { startAt: local(TODAY, "08:00"), endAt: local(TODAY, "12:00") })
    expect(e).toMatchObject({ startAt: "2026-11-05T07:00:00.000Z", source: "manual", minutes: 240, corrected: false })
    const past = { startAt: local("2026-11-03", "08:00"), endAt: local("2026-11-03", "12:00") }
    expect(() => createEntry(A, past)).toThrow(expect.objectContaining({ fields: { reason: "required" } }))
    const p = createEntry(A, { ...past, reason: "Forgot to clock in" })
    expect(entryHistory(A, p.id)[0]).toMatchObject({ action: "create", reason: "Forgot to clock in" })
    withSettings({ reason_required_for_past_edits: false })
    expect(
      createEntry(A, { startAt: local("2026-11-02", "08:00"), endAt: local("2026-11-02", "09:00") }).id,
    ).toBeGreaterThan(0)
  })

  it("validates order, future, length and overlap", () => {
    const { anna } = org()
    const A = loadActor(anna.id)
    const bad = (startAt: string, endAt: string, field: string, code: string) =>
      expect(() => createEntry(A, { startAt, endAt, reason: "x" })).toThrow(
        expect.objectContaining({ fields: { [field]: code } }),
      )
    bad(local(TODAY, "12:00"), local(TODAY, "08:00"), "endAt", "before_start")
    bad(local(TODAY, "16:00"), local(TODAY, "18:00"), "startAt", "future")
    bad(local("2026-11-02", "08:00"), local("2026-11-03", "09:00"), "endAt", "too_long")
    createEntry(A, { startAt: local(TODAY, "08:00"), endAt: local(TODAY, "12:00") })
    expect(() => createEntry(A, { startAt: local(TODAY, "11:00"), endAt: local(TODAY, "13:00") })).toThrow(
      expect.objectContaining({ code: "overlap" }),
    )
    // a break is a clock-out: new entries are always work
    expect(createEntry(A, { startAt: local(TODAY, "12:00"), endAt: local(TODAY, "12:30") }).kind).toBe("work")
  })

  it("own edits are logged, soft delete keeps history, restore brings it back", () => {
    const { anna } = org()
    const A = loadActor(anna.id)
    const e = createEntry(A, { startAt: local(TODAY, "08:00"), endAt: local(TODAY, "12:00") })
    const u = updateEntry(A, e.id, { startAt: local(TODAY, "07:45") })
    expect(u).toMatchObject({ edited: true, corrected: false })
    const hist = entryHistory(A, e.id)
    expect(hist.map((h) => h.action)).toEqual(["create", "update"])
    expect(hist[1]).toMatchObject({
      before: { start_at: "2026-11-05T07:00:00.000Z" },
      after: { start_at: "2026-11-05T06:45:00.000Z" },
      changed: ["start_at"],
      actor: { name: "Anna A" },
    })
    expect(updateEntry(A, e.id, { note: "" }).edited).toBe(true)
    expect(entryHistory(A, e.id)).toHaveLength(2) // no-op change writes nothing
    expect(() => updateEntry(A, e.id, { endAt: null })).toThrow(
      expect.objectContaining({ fields: { endAt: "required" } }),
    )

    deleteEntry(A, e.id)
    expect(listEntries(A, anna.id, TODAY, TODAY)).toEqual([])
    expect(listEntries(A, anna.id, TODAY, TODAY, true)[0].deleted).toBe(true)
    expect(() => updateEntry(A, e.id, { note: "x" })).toThrow(expect.objectContaining({ code: "deleted" }))
    expect(restoreEntry(A, e.id).deleted).toBe(false)
    expect(entryHistory(A, e.id).map((h) => h.action)).toEqual(["create", "update", "delete", "restore"])
    expect(userHistory(A, anna.id).length).toBe(4)
  })

  it("restore refuses when the time was taken meanwhile", () => {
    const { anna } = org()
    const A = loadActor(anna.id)
    const e = createEntry(A, { startAt: local(TODAY, "08:00"), endAt: local(TODAY, "12:00") })
    deleteEntry(A, e.id)
    createEntry(A, { startAt: local(TODAY, "09:00"), endAt: local(TODAY, "10:00") })
    expect(() => restoreEntry(A, e.id)).toThrow(expect.objectContaining({ code: "overlap" }))
  })

  it("deleting a running entry closes it", () => {
    const { anna } = org()
    const e = makeEntry(anna.id, "2026-11-05T07:00:00.000000Z", null, { source: "clock" })
    deleteEntry(loadActor(anna.id), e.id)
    const row = listEntries(loadActor(anna.id), anna.id, TODAY, TODAY, true)[0]
    expect(row).toMatchObject({ deleted: true, endAt: "2026-11-05T14:00:00.000Z" })
  })
})

describe("corrections by others", () => {
  it("lead correction needs a reason, notifies, mails after commit and can be disputed", () => {
    const { anna, lead } = org()
    const A = loadActor(anna.id)
    const L = loadActor(lead.id)
    const e = createEntry(A, { startAt: local(TODAY, "08:00"), endAt: local(TODAY, "12:00") })
    expect(() => updateEntry(L, e.id, { endAt: local(TODAY, "12:30") })).toThrow(
      expect.objectContaining({ fields: { reason: "required" } }),
    )
    withOutbox(() => updateEntry(L, e.id, { endAt: local(TODAY, "12:30") }, "Meeting ran late"))
    expect(listEntries(A, anna.id, TODAY, TODAY)[0].corrected).toBe(true)
    const n = listNotifications(anna.id)[0]
    expect(n.kind).toBe("entry_corrected")
    expect(n.payload).toMatchObject({ reason: "Meeting ran late", actor_name: "Lea Lead", action: "update" })
    expect(queueMail).toHaveBeenCalledWith(
      expect.objectContaining({ email: anna.email }),
      "entry_corrected",
      expect.objectContaining({ reason: "Meeting ran late" }),
    )
    expect(entryHistory(A, e.id).at(-1)).toMatchObject({ actor: { name: "Lea Lead" }, reason: "Meeting ran late" })

    disputeEntry(A, e.id, "I left at 12:00")
    expect(listNotifications(lead.id)[0]).toMatchObject({
      kind: "entry_disputed",
      payload: expect.objectContaining({ message: "I left at 12:00" }),
    })
    expect(() => disputeEntry(L, e.id, "x")).toThrow(expect.objectContaining({ code: "forbidden" }))
    expect(() => disputeEntry(A, e.id, " ")).toThrow(expect.objectContaining({ fields: { message: "required" } }))
    const own = createEntry(A, { startAt: local(TODAY, "13:00"), endAt: local(TODAY, "14:00") })
    expect(() => disputeEntry(A, own.id, "x")).toThrow(expect.objectContaining({ code: "nothing_to_dispute" }))
  })

  it("mail is dropped when the transaction fails", () => {
    const { anna, lead } = org()
    const e = createEntry(loadActor(anna.id), { startAt: local(TODAY, "08:00"), endAt: local(TODAY, "12:00") })
    expect(() =>
      withOutbox(() => {
        updateEntry(loadActor(lead.id), e.id, { note: "x" }, "r")
        throw new Error("rollback")
      }),
    ).toThrow("rollback")
    expect(queueMail).not.toHaveBeenCalled()
  })

  it("permissions: lead for own team, HR for all, never admins or colleagues", () => {
    const { anna, ben, carl, lead, hr, admin } = org()
    const L = loadActor(lead.id)
    const added = createEntry(L, {
      userId: anna.id,
      startAt: local("2026-11-04", "08:00"),
      endAt: local("2026-11-04", "12:00"),
      reason: "Paper timesheet",
    })
    expect(added.corrected).toBe(true)
    const c = createEntry(loadActor(carl.id), { startAt: local(TODAY, "08:00"), endAt: local(TODAY, "12:00") })
    const notFound = expect.objectContaining({ code: "not_found" })
    expect(() => updateEntry(L, c.id, { note: "x" }, "x")).toThrow(notFound)
    expect(() =>
      createEntry(L, {
        userId: carl.id,
        startAt: local("2026-11-04", "08:00"),
        endAt: local("2026-11-04", "12:00"),
        reason: "x",
      }),
    ).toThrow(notFound)
    const B = loadActor(ben.id)
    expect(() => updateEntry(B, added.id, { note: "hacked" }, "x")).toThrow(notFound)
    expect(() => deleteEntry(B, added.id)).toThrow(notFound)
    expect(() => entryHistory(B, added.id)).toThrow(notFound)
    expect(() => getEntry(B, added.id)).toThrow(notFound)
    expect(() => listEntries(B, anna.id, TODAY, TODAY)).toThrow(notFound)
    expect(() => updateEntry(loadActor(admin.id), c.id, { note: "x" }, "x")).toThrow(notFound)
    expect(updateEntry(loadActor(hr.id), c.id, { note: "ok" }, "check").note).toBe("ok")
    expect(() => restoreEntry(L, c.id)).toThrow(notFound)
  })
})

describe("sign-off lock", () => {
  it("refuses create, update and delete in a signed-off month (service and trigger)", () => {
    const { anna, hr } = org()
    const A = loadActor(anna.id)
    const e = createEntry(A, {
      startAt: local("2026-10-30", "08:00"),
      endAt: local("2026-10-30", "12:00"),
      reason: "x",
    })
    lockMonth(anna.id, "2026-10")
    const locked = expect.objectContaining({ code: "period_signed_off" })
    expect(() =>
      createEntry(A, { startAt: local("2026-10-29", "08:00"), endAt: local("2026-10-29", "12:00"), reason: "x" }),
    ).toThrow(locked)
    expect(() => updateEntry(loadActor(hr.id), e.id, { note: "x" }, "x")).toThrow(locked)
    // moving an entry out of the locked month is a change to the locked month too
    expect(() =>
      updateEntry(A, e.id, { startAt: local("2026-11-02", "08:00"), endAt: local("2026-11-02", "12:00") }, "x"),
    ).toThrow(locked)
    expect(() => deleteEntry(A, e.id, "x")).toThrow(locked)
    expect(() => rawSqlite().prepare("UPDATE time_entries SET note = 'x' WHERE id = ?").run(e.id)).toThrow(
      /period signed off/,
    )
    expect(
      createEntry(A, { startAt: local("2026-11-02", "08:00"), endAt: local("2026-11-02", "12:00"), reason: "x" }).id,
    ).toBeGreaterThan(0)
  })
})

it("every entry write creates a revision whose last snapshot matches the row", () => {
  const { anna, lead } = org()
  const A = loadActor(anna.id)
  const e = createEntry(A, { startAt: local(TODAY, "07:00"), endAt: local(TODAY, "08:00") })
  updateEntry(loadActor(lead.id), e.id, { note: "n" }, "r")
  deleteEntry(A, e.id)
  const rows = rawSqlite().prepare("SELECT id, end_at FROM time_entries").all() as { id: number; end_at: string }[]
  for (const r of rows) {
    const revs = rawSqlite()
      .prepare("SELECT after FROM revisions WHERE entity = 'time_entry' AND entity_id = ? ORDER BY id")
      .all(r.id) as { after: string }[]
    expect(revs.length).toBeGreaterThan(0)
    expect(JSON.parse(revs.at(-1)!.after).end_at).toBe(new Date(Date.parse(r.end_at)).toISOString())
  }
})
