import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { makeAdmin, makeCalendar, makeTeam, makeUser } from "@/test/factories"
import { db } from "../db"
import * as s from "../db/schema"
import {
  addCompanyDay,
  calendarYear,
  calendarYearWithKinds,
  companyDayOptions,
  createCalendarFromPreset,
  deleteHoliday,
  holidayPresets,
  importPreset,
  knabenschiessen,
  listCalendars,
  myHolidays,
  presetHolidays,
  saveCalendar,
  saveHoliday,
  sechselaeuten,
  topUpHolidays,
} from "./holiday-calendars"
import { loadActor } from "./permissions"

function signOffThrough(end: string) {
  const u = makeUser()
  db.insert(s.monthSignoffs)
    .values({
      userId: u.id,
      month: end.slice(0, 7),
      periodStartDate: `${end.slice(0, 7)}-01`,
      periodEndDate: end,
      periodStartUtc: "2026-01-01T00:00:00.000000Z",
      periodEndUtc: "2026-02-01T00:00:00.000000Z",
      digest: "d",
      seal: "s",
    })
    .run()
}

describe("holiday calendars", () => {
  it("imports the public holidays of canton Zurich", () => {
    const admin = loadActor(makeAdmin().id)
    const cal = saveCalendar(admin, { name: "Zürich", regionCode: "", description: "", isDefault: true })
    expect(importPreset(admin, cal.id, { preset: "CH-ZH", year: 2026, replace: false })).toEqual({
      added: 9,
      skipped: 0,
    })
    const days = Object.fromEntries(calendarYear(admin, cal.id, 2026).map((h) => [h.date, h.name]))
    expect(days["2026-04-06"]).toBe("Easter Monday")
    expect(days["2026-08-01"]).toBe("Swiss National Day")
    expect(days["2026-12-25"]).toBe("Christmas Day")
    expect(days["2026-09-14"]).toBeUndefined() // Knabenschiessen is not a public holiday
    expect(days["2026-04-05"]).toBeUndefined() // Easter Sunday is a Sunday anyway
    expect(listCalendars(admin)[0]).toMatchObject({ regionCode: "CH-ZH", holidayCount: 9, hasPreset: true })
    const kinds = Object.fromEntries(calendarYearWithKinds(admin, cal.id, 2026).map((h) => [h.date, h.kind]))
    expect(kinds["2026-08-01"]).toBe("federal")
    expect(kinds["2026-04-06"]).toBe("cantonal")
    expect(() => importPreset(admin, cal.id, { preset: "XX", year: 2026, replace: false })).toThrow(/Unknown preset/)
    expect(() => importPreset(admin, cal.id, { preset: "DE-BY", year: 2026, replace: false })).toThrow(/Unknown preset/)
    expect(() => saveCalendar(admin, { name: "X", regionCode: "DE", description: "", isDefault: false })).toThrow(
      /Unknown preset/,
    )
  })

  it("offers Swiss presets only, local presets by rule for any year", () => {
    expect(holidayPresets()).toHaveLength(27)
    expect(holidayPresets().map((p) => p.key)).toEqual(expect.arrayContaining(["CH-ZH", "CH-FR", "ch-fr-fribourg"]))
    const city = presetHolidays("ch-fr-fribourg", 2031).map((h) => h.name)
    expect(city).toHaveLength(9)
    expect(city).not.toContain("Easter Monday")
    const fr = createCalendarFromPreset("ch-fr-fribourg", { years: [2026] })
    expect(fr.regionCode).toBe("ch-fr-fribourg")
    const cal = createCalendarFromPreset("CH-BE", { years: [2026], makeDefault: true })
    expect(cal.isDefault).toBe(true)
    expect(cal.name).toBe("CH-BE Canton of Bern")
    expect(createCalendarFromPreset("CH-BE", { years: [2026, 2027] }).id).toBe(cal.id)
    expect(() => createCalendarFromPreset("XX")).toThrow(/Unknown preset/)
  })

  it("refuses holiday changes inside signed-off months", () => {
    const admin = loadActor(makeAdmin().id)
    const cal = makeCalendar({}, [{ date: "2026-01-01", name: "New Year's Day" }])
    signOffThrough("2026-01-31")
    expect(() => saveHoliday(admin, cal.id, { date: "2026-01-02", name: "Berchtold's Day", fraction: 1 })).toThrow(
      /signed-off/,
    )
    const jan1 = calendarYear(admin, cal.id, 2026)[0]
    expect(() => deleteHoliday(admin, jan1.id)).toThrow(/signed-off/)
    expect(saveHoliday(admin, cal.id, { date: "2026-02-02", name: "Company day", fraction: 0.5 }).fraction).toBe(0.5)
    // the import skips frozen dates instead of failing
    expect(importPreset(admin, cal.id, { preset: "CH-ZH", year: 2026, replace: false }).skipped).toBeGreaterThan(0)
  })

  it("computes the Zurich customs", () => {
    expect(sechselaeuten(2026)).toBe("2026-04-20")
    expect(sechselaeuten(2025)).toBe("2025-04-28") // third Monday is Easter Monday
    expect(sechselaeuten(2019)).toBe("2019-04-08") // third Monday is in Holy Week
    expect(knabenschiessen(2026)).toBe("2026-09-14")
    expect(knabenschiessen(2024)).toBe("2024-09-09")
  })

  it("adds optional company days on request only", () => {
    const admin = loadActor(makeAdmin().id)
    const zh = createCalendarFromPreset("CH-ZH", { years: [2026] })
    const keys = companyDayOptions(admin, zh.id, 2026).map((d) => d.key)
    expect(keys).toEqual(["dec24_pm", "dec31_pm", "berchtold", "sechselaeuten_pm", "knabenschiessen_pm"])
    expect(addCompanyDay(admin, zh.id, "dec24_pm", 2026)).toMatchObject({ date: "2026-12-24", fraction: 0.5 })
    expect(companyDayOptions(admin, zh.id, 2026).find((d) => d.key === "dec24_pm")?.added).toBe(true)
    expect(() => addCompanyDay(admin, zh.id, "dec24_pm", 2026)).toThrow(/already a holiday/)
    expect(calendarYearWithKinds(admin, zh.id, 2026).find((h) => h.date === "2026-12-24")?.kind).toBe("company")
    // Berchtoldstag is cantonal in Bern, so it is not offered there; Zurich customs only in Zurich
    const be = createCalendarFromPreset("CH-BE", { years: [2026] })
    expect(companyDayOptions(admin, be.id, 2026).map((d) => d.key)).toEqual(["dec24_pm", "dec31_pm"])
    expect(() => addCompanyDay(admin, be.id, "sechselaeuten_pm", 2026)).toThrow(/Not available/)
    expect(() => companyDayOptions(loadActor(makeUser().id), zh.id, 2026)).toThrow(/Administrators only/)
  })

  it("is for administrators only", () => {
    const emp = loadActor(makeUser().id)
    expect(() => listCalendars(emp)).toThrow(/Administrators only/)
    expect(() => saveCalendar(emp, { name: "X", regionCode: "", description: "", isDefault: false })).toThrow(
      /Administrators only/,
    )
  })
})

const notes = (kind: string) => db.select().from(s.notifications).where(eq(s.notifications.kind, kind)).all()

describe("holiday top-up", () => {
  it("adds next year's holidays once, idempotently, and notifies administrators", () => {
    const admin = makeAdmin()
    const cal = createCalendarFromPreset("CH-ZH", { years: [2026] })
    const first = topUpHolidays("2026-10-01")
    expect(first.topped).toEqual([{ calendarId: cal.id, year: 2027, added: 9 }])
    expect(notes("holidays_topped_up")).toMatchObject([
      { userId: admin.id, payload: { calendar_id: cal.id, calendar: cal.name, year: 2027, count: 9 } },
    ])
    expect(topUpHolidays("2026-10-02").topped).toEqual([])
    expect(notes("holidays_topped_up")).toHaveLength(1)
    // a deleted holiday stays deleted; nothing is updated or re-added
    const adm = loadActor(admin.id)
    deleteHoliday(adm, calendarYear(adm, cal.id, 2027)[0].id)
    expect(topUpHolidays("2026-10-03").topped).toEqual([])
    expect(calendarYear(adm, cal.id, 2027)).toHaveLength(8)
  })

  it("fills a missing current year but never dates inside signed-off periods", () => {
    makeAdmin()
    const cal = makeCalendar({ regionCode: "CH-BE" })
    signOffThrough("2026-05-31")
    const r = topUpHolidays("2026-07-01")
    expect(r.topped.map((t) => t.year)).toEqual([2026, 2027])
    const dates = db
      .select()
      .from(s.holidays)
      .where(eq(s.holidays.calendarId, cal.id))
      .all()
      .map((h) => h.date)
    expect(dates.filter((d) => d <= "2026-05-31")).toEqual([])
    expect(dates).toContain("2026-08-01")
  })

  it("warns once from 1 November about calendars without a preset", () => {
    makeAdmin()
    const manual = makeCalendar({}, [{ date: "2026-12-25", name: "Christmas Day" }])
    expect(topUpHolidays("2026-10-15").missing).toEqual([])
    expect(topUpHolidays("2026-11-01").missing).toEqual([{ calendarId: manual.id, year: 2027 }])
    expect(topUpHolidays("2026-11-02").missing).toEqual([])
    expect(notes("holidays_missing")).toHaveLength(1)
    db.insert(s.holidays).values({ calendarId: manual.id, date: "2027-01-01", name: "New Year's Day" }).run()
    expect(topUpHolidays("2027-11-01").missing).toEqual([{ calendarId: manual.id, year: 2028 }])
  })
})

describe("my holidays", () => {
  it("shows the calendar that applies: personal, then team, then company default", () => {
    const none = makeUser()
    expect(myHolidays(loadActor(none.id), 2026)).toBeNull()
    makeCalendar({ name: "Default" }, [{ date: "2026-08-01", name: "National Day" }])
    const teamCal = makeCalendar({ name: "Zurich", isDefault: false, regionCode: "CH-ZH" }, [
      { date: "2026-04-20", name: "Sechseläuten", fraction: 0.5 },
      { date: "2027-01-01", name: "New Year's Day" },
    ])
    const own = makeCalendar({ name: "Ticino", isDefault: false }, [])
    const team = makeTeam({ holidayCalendarId: teamCal.id })
    const member = makeUser({ teamId: team.id })
    const moved = makeUser({ teamId: team.id, holidayCalendarId: own.id })

    expect(myHolidays(loadActor(none.id), 2026)).toMatchObject({ name: "Default", source: "default" })
    const mine = myHolidays(loadActor(member.id), 2026)
    expect(mine).toMatchObject({ name: "Zurich", source: "team", firstYear: 2026, lastYear: 2027 })
    expect(mine?.holidays).toEqual([
      expect.objectContaining({ date: "2026-04-20", name: "Sechseläuten", fraction: 0.5 }),
    ])
    expect(myHolidays(loadActor(moved.id), 2026)).toMatchObject({ name: "Ticino", source: "user", holidays: [] })
  })

  it("is open to every role, also without admin rights", () => {
    makeCalendar({}, [{ date: "2026-12-25", name: "Christmas" }])
    const admin = makeAdmin()
    const employee = makeUser()
    expect(myHolidays(loadActor(employee.id), 2026)?.holidays).toHaveLength(1)
    expect(myHolidays(loadActor(admin.id), 2026)?.holidays).toHaveLength(1)
    expect(() => listCalendars(loadActor(employee.id))).toThrow()
  })
})
