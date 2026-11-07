import { beforeEach, describe, expect, it } from "vitest"
import { rawSqlite } from "@/server/db"
import { freeze } from "@/server/time"
import {
  loadActor,
  lockMonth,
  makeAdmin,
  makeCalendar,
  makeLead,
  makeSchedule,
  makeTeam,
  makeUser,
  withSettings,
} from "@/test/factories"
import { holidayHalves, holidaysFor, resolveCalendarId } from "./holidays"
import {
  ensureHolidayChangeAllowed,
  ensureOpenDates,
  ensureOpenInstants,
  ensureScheduleChangeAllowed,
  lockedMonths,
  signedMonthsOverlapping,
} from "./locks"
import {
  createSchedule,
  defaultScheduleMinutes,
  deleteSchedule,
  listSchedules,
  minutesOn,
  scheduleEditor,
  scheduleOn,
  schedulesOf,
  updateSchedule,
} from "./schedules"

const WEEK = { mon: 480, tue: 480, wed: 480, thu: 480, fri: 240, sat: 0, sun: 0 }

beforeEach(() => freeze("2026-11-05T14:00:00Z"))

function setup() {
  const team = makeTeam()
  const lead = makeUser()
  makeLead(team.id, lead.id)
  const emp = makeUser({ teamId: team.id })
  makeSchedule(emp.id, { validFrom: "2026-01-01" })
  return { team, lead, emp, hr: makeUser({ capabilities: ["hr"] }), admin: makeAdmin() }
}

describe("schedules", () => {
  it("resolves the version valid on a day", () => {
    const { emp, hr } = setup()
    createSchedule(loadActor(hr.id), emp.id, { validFrom: "2026-06-01", pensumPercent: 90, minutes: WEEK }, "contract")
    const all = schedulesOf(emp.id)
    expect(scheduleOn(all, "2025-12-31")).toBeNull()
    expect(scheduleOn(all, "2026-05-31")?.validFrom).toBe("2026-01-01")
    const june = scheduleOn(all, "2026-06-05")!
    expect(minutesOn(june, "2026-06-05")).toBe(240) // Friday
    expect(listSchedules(loadActor(emp.id), emp.id).at(-1)).toMatchObject({ weeklyMinutes: 2160, minutes: WEEK })
    expect(defaultScheduleMinutes(2520, 80)).toMatchObject({ mon: 403, sat: 0 })
  })

  it("permissions: HR, leads (setting), never employees or plain admins", () => {
    const { emp, lead, hr, admin } = setup()
    const input = { validFrom: "2026-07-01", pensumPercent: 100, minutes: WEEK }
    expect(() => createSchedule(loadActor(emp.id), emp.id, input)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    )
    expect(() => createSchedule(loadActor(admin.id), emp.id, input)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    )
    const s = createSchedule(loadActor(lead.id), emp.id, input, "new contract")
    withSettings({ lead_can_edit_schedules: false })
    expect(() => updateSchedule(loadActor(lead.id), s.id, input)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    )
    expect(updateSchedule(loadActor(hr.id), s.id, { ...input, pensumPercent: 50 }, "fix").pensumPercent).toBe(50)
    const stranger = makeUser()
    expect(() => listSchedules(loadActor(stranger.id), emp.id)).toThrow(expect.objectContaining({ code: "not_found" }))
  })

  it("validates, replaces same-day versions, keeps the last one and logs revisions", () => {
    const { emp, hr } = setup()
    const H = loadActor(hr.id)
    expect(() => createSchedule(H, emp.id, { validFrom: "2026-07-01", pensumPercent: 0, minutes: WEEK })).toThrow(
      /Employment level/,
    )
    expect(() =>
      createSchedule(H, emp.id, { validFrom: "2026-07-01", pensumPercent: 100, minutes: { ...WEEK, mon: 2000 } }),
    ).toThrow(/Daily minutes/)
    expect(() => createSchedule(H, emp.id, { validFrom: "x", pensumPercent: 100, minutes: WEEK })).toThrow(
      /Invalid date/,
    )
    const a = createSchedule(H, emp.id, { validFrom: "2026-07-01", pensumPercent: 100, minutes: WEEK }, "contract")
    const b = createSchedule(H, emp.id, { validFrom: "2026-07-01", pensumPercent: 80, minutes: WEEK }, "fix")
    expect(b.id).toBe(a.id)
    expect(() => updateSchedule(H, a.id, { validFrom: "2026-01-01", pensumPercent: 80, minutes: WEEK }, "x")).toThrow(
      expect.objectContaining({ fields: { validFrom: "taken" } }),
    )
    deleteSchedule(H, a.id, "mistake")
    const only = schedulesOf(emp.id)[0]
    expect(() => deleteSchedule(H, only.id)).toThrow(expect.objectContaining({ code: "last_schedule" }))
    const actions = rawSqlite().prepare("SELECT action FROM revisions WHERE entity = 'schedule' ORDER BY id").all()
    expect(actions).toEqual([{ action: "create" }, { action: "update" }, { action: "delete" }])
  })

  it("needs a reason for versions before today, not for future ones or the first version", () => {
    const { emp, hr } = setup()
    const H = loadActor(hr.id)
    const past = { validFrom: "2026-10-01", pensumPercent: 80, minutes: WEEK }
    expect(() => createSchedule(H, emp.id, past)).toThrow(expect.objectContaining({ fields: { reason: "required" } }))
    expect(() => createSchedule(H, emp.id, past, "  ")).toThrow(expect.objectContaining({ code: "validation_error" }))
    const future = createSchedule(H, emp.id, { ...past, validFrom: "2026-12-01" })
    expect(() => updateSchedule(H, future.id, past)).toThrow(
      expect.objectContaining({ fields: { reason: "required" } }),
    )
    expect(updateSchedule(H, future.id, { ...past, validFrom: "2027-01-01" }).validFrom).toBe("2027-01-01")
    deleteSchedule(H, future.id)
    const old = createSchedule(H, emp.id, past, "new contract")
    expect(() => deleteSchedule(H, old.id)).toThrow(expect.objectContaining({ fields: { reason: "required" } }))
    const fresh = makeUser()
    expect(createSchedule(H, fresh.id, { ...past, validFrom: "2025-01-01" }).id).toBeGreaterThan(0)
  })

  it("editor data: versions, edit right per role and setting", () => {
    const { emp, lead, hr, admin } = setup()
    expect(scheduleEditor(loadActor(hr.id), emp.id)).toMatchObject({
      canEdit: true,
      fulltimeWeeklyMinutes: 2520,
      today: "2026-11-05",
      schedules: [{ validFrom: "2026-01-01" }],
    })
    expect(scheduleEditor(loadActor(lead.id), emp.id).canEdit).toBe(true)
    withSettings({ lead_can_edit_schedules: false })
    expect(scheduleEditor(loadActor(lead.id), emp.id).canEdit).toBe(false)
    expect(scheduleEditor(loadActor(admin.id), emp.id).canEdit).toBe(false)
    expect(scheduleEditor(loadActor(emp.id), emp.id).canEdit).toBe(false)
    expect(() => scheduleEditor(loadActor(makeUser().id), emp.id)).toThrow(
      expect.objectContaining({ code: "not_found" }),
    )
  })

  it("refuses versions reaching into signed-off months (service and trigger)", () => {
    const { emp, hr } = setup()
    lockMonth(emp.id, "2026-09")
    const H = loadActor(hr.id)
    expect(() => createSchedule(H, emp.id, { validFrom: "2026-09-15", pensumPercent: 100, minutes: WEEK })).toThrow(
      expect.objectContaining({ code: "period_signed_off" }),
    )
    expect(
      createSchedule(H, emp.id, { validFrom: "2026-10-01", pensumPercent: 100, minutes: WEEK }, "contract").id,
    ).toBeGreaterThan(0)
    const first = schedulesOf(emp.id)[0]
    expect(() => deleteSchedule(H, first.id)).toThrow(expect.objectContaining({ code: "period_signed_off" }))
    expect(() =>
      rawSqlite().prepare("UPDATE work_schedules SET pensum_percent = 50 WHERE id = ?").run(first.id),
    ).toThrow(/period signed off/)
  })
})

describe("locks", () => {
  it("reports and enforces signed-off months", () => {
    const u = makeUser({ name: "Uma" })
    const signer = makeUser({ name: "Sid" })
    const row = lockMonth(u.id, "2026-03", { signedById: signer.id })
    expect(signedMonthsOverlapping(u.id, "2026-03-31", "2026-04-02")).toHaveLength(1)
    expect(signedMonthsOverlapping(u.id, "2026-04-01", "2026-04-30")).toHaveLength(0)
    expect(() => ensureOpenDates(u, "2026-02-20", "2026-03-01")).toThrow(
      expect.objectContaining({ code: "period_signed_off", fields: { months: ["2026-03"] } }),
    )
    ensureOpenDates(u, "2026-04-01")
    // 31 Mar 23:30 Zurich is still March; 22:30 UTC on 31 Mar is 00:30 on 1 Apr
    expect(() => ensureOpenInstants(u, "2026-03-31T21:30:00.000000Z")).toThrow(
      expect.objectContaining({ code: "period_signed_off" }),
    )
    ensureOpenInstants(u, "2026-03-31T22:30:00.000000Z", null)
    expect(() => ensureScheduleChangeAllowed(u, "2026-01-01")).toThrow(
      expect.objectContaining({ code: "period_signed_off" }),
    )
    ensureScheduleChangeAllowed(u, "2026-04-01")
    expect(() => ensureHolidayChangeAllowed("2026-03-31")).toThrow(
      expect.objectContaining({ code: "period_signed_off" }),
    )
    ensureHolidayChangeAllowed("2026-04-01")
    expect(lockedMonths(u, "2026-01-01", "2026-12-31")).toEqual({
      "2026-03": { id: row.id, signedBy: "Sid", signedAt: expect.any(String), note: "" },
    })
  })
})

describe("holidays", () => {
  it("resolves person, team, then default calendar", () => {
    const def = makeCalendar({ isDefault: true }, [{ date: "2026-08-01", name: "National Day" }])
    const teamCal = makeCalendar({ isDefault: false }, [{ date: "2026-08-01", name: "Team" }])
    const own = makeCalendar({ isDefault: false }, [{ date: "2026-12-24", name: "Eve", fraction: 0.5 }])
    const team = makeTeam({ holidayCalendarId: teamCal.id })
    expect(resolveCalendarId(makeUser())).toBe(def.id)
    expect(resolveCalendarId(makeUser({ teamId: team.id }))).toBe(teamCal.id)
    const u = makeUser({ teamId: team.id, holidayCalendarId: own.id })
    expect(resolveCalendarId(u)).toBe(own.id)
    expect([...holidaysFor(u, "2026-01-01", "2026-12-31").keys()]).toEqual(["2026-12-24"])
    expect(holidayHalves(0.5)).toEqual(["pm"])
    expect(holidayHalves(0)).toEqual([])
  })
})
