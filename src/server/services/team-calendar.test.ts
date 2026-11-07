import { beforeEach, describe, expect, it } from "vitest"
import type { AppError } from "@/server/errors"
import { loadActor, makeOrg } from "@/test/factories"
import { createAbsence } from "./absences"
import { teamCalendar } from "./team-calendar"

let org: ReturnType<typeof makeOrg>
beforeEach(() => {
  org = makeOrg()
  createAbsence(loadActor(org.anna.id), { type: "sick", startDate: "2026-11-05", note: "Migraine" })
  createAbsence(loadActor(org.lead.id), { userId: org.ben.id, type: "vacation", startDate: "2026-11-05" })
})

const day = (cal: ReturnType<typeof teamCalendar>, userId: number) =>
  cal.rows.find((r) => r.user.id === userId)?.days[0]

describe("team calendar", () => {
  it("shows colleagues' sick leave only as absent", () => {
    const cal = teamCalendar(loadActor(org.ben.id), { from: "2026-11-05", to: "2026-11-05" })
    expect(day(cal, org.anna.id)?.absences[0]).toMatchObject({
      id: null,
      typeKey: "absent",
      label: "Absent",
      category: "other",
    })
    expect(JSON.stringify(cal)).not.toMatch(/Migraine|sick/)
    expect(day(cal, org.ben.id)?.absences[0]).toMatchObject({ typeKey: "vacation" })
    expect(cal.rows.map((r) => r.user.id)).not.toContain(org.carl.id)
    expect(cal.teams.map((t) => t.name)).toEqual(["Team A"])
  })

  it("shows details to the person, their lead and HR", () => {
    for (const id of [org.anna.id, org.lead.id, org.hr!.id]) {
      const cal = teamCalendar(loadActor(id), { from: "2026-11-05", to: "2026-11-05" })
      expect(day(cal, org.anna.id)?.absences[0].typeKey).toBe("sick")
    }
    const hr = teamCalendar(loadActor(org.hr!.id), { from: "2026-11-05", to: "2026-11-05", teamId: org.teamB.id })
    expect(hr.rows.map((r) => r.user.id)).toEqual([org.carl.id])
  })

  it("administrators without HR see nobody else's absences", () => {
    const cal = teamCalendar(loadActor(org.admin.id), { from: "2026-11-05", to: "2026-11-05" })
    expect(cal.rows.map((r) => r.user.id)).toEqual([org.admin.id])
  })

  it("limits the range", () => {
    let e: AppError | null = null
    try {
      teamCalendar(loadActor(org.ben.id), { from: "2026-01-01", to: "2026-06-01" })
    } catch (x) {
      e = x as AppError
    }
    expect(e?.fields).toEqual({ to: "too_long" })
  })
})
