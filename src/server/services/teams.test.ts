import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { makeAdmin, makeTeam, makeUser } from "@/test/factories"
import { db } from "../db"
import * as s from "../db/schema"
import { freeze } from "../time"
import { activeLeadRows, loadActor } from "./permissions"
import { addLead, createTeam, deleteTeam, listTeams, removeLead, setMembers, updateLead, updateTeam } from "./teams"

describe("teams administration", () => {
  it("is for administrators only", () => {
    const emp = loadActor(makeUser().id)
    const team = makeTeam()
    expect(() => listTeams(emp)).toThrow(/Administrators only/)
    expect(() => createTeam(emp, { name: "X", color: "#112233", holidayCalendarId: null })).toThrow(
      /Administrators only/,
    )
    expect(() => addLead(emp, team.id, { userId: emp.id, role: "lead", validFrom: null, validTo: null })).toThrow(
      /Administrators only/,
    )
  })

  it("creates, renames and deletes teams; members become team-less", () => {
    const admin = loadActor(makeAdmin().id)
    const t = createTeam(admin, { name: "Support", color: "#112233", holidayCalendarId: null })
    expect(() => createTeam(admin, { name: "Support", color: "#112233", holidayCalendarId: null })).toThrow(
      /check your input/,
    )
    expect(updateTeam(admin, t.id, { name: "Service" }).name).toBe("Service")
    const a = makeUser({ name: "A" })
    const b = makeUser({ name: "B" })
    setMembers(admin, t.id, [a.id, b.id])
    expect(listTeams(admin)[0].members.map((m) => m.name)).toEqual(["A", "B"])
    setMembers(admin, t.id, [b.id])
    expect(db.select().from(s.users).where(eq(s.users.id, a.id)).get()?.teamId).toBeNull()
    deleteTeam(admin, t.id)
    expect(db.select().from(s.users).where(eq(s.users.id, b.id)).get()?.teamId).toBeNull()
  })

  it("leads and deputies count only within their period and are notified", () => {
    freeze("2026-07-10T08:00:00Z")
    const admin = loadActor(makeAdmin().id)
    const team = makeTeam()
    const lead = makeUser()
    const deputy = makeUser()
    addLead(admin, team.id, { userId: lead.id, role: "lead", validFrom: null, validTo: null })
    const dep = addLead(admin, team.id, {
      userId: deputy.id,
      role: "deputy",
      validFrom: "2026-07-13",
      validTo: "2026-07-24",
    })
    expect(activeLeadRows({ teamId: team.id }).map((r) => r.userId)).toEqual([lead.id])
    expect(
      activeLeadRows({ teamId: team.id, on: "2026-07-20" })
        .map((r) => r.userId)
        .sort((a, b) => a - b),
    ).toEqual([lead.id, deputy.id].sort((a, b) => a - b))
    expect(loadActor(deputy.id).ledTeamIds.size).toBe(0)
    freeze("2026-07-14T08:00:00Z")
    expect(loadActor(deputy.id).ledTeamIds.has(team.id)).toBe(true)
    expect(listTeams(admin)[0].leads.find((l) => l.userId === deputy.id)?.active).toBe(true)

    expect(() =>
      addLead(admin, team.id, { userId: deputy.id, role: "deputy", validFrom: "2026-07-13", validTo: "2026-07-24" }),
    ).toThrow(/already has that role/)
    expect(() =>
      addLead(admin, team.id, { userId: deputy.id, role: "deputy", validFrom: "2026-07-24", validTo: "2026-07-13" }),
    ).toThrow(/check your input/)
    updateLead(admin, dep.id, { role: "deputy", validFrom: "2026-07-13", validTo: "2026-07-13" })
    expect(loadActor(deputy.id).ledTeamIds.size).toBe(0)

    const notes = db.select().from(s.notifications).where(eq(s.notifications.userId, deputy.id)).all()
    expect(notes.map((n) => n.kind)).toEqual(["lead_assigned"])
    expect(notes[0].payload).toMatchObject({ role: "deputy", valid_from: "2026-07-13", valid_to: "2026-07-24" })
    const log = db.select().from(s.revisions).where(eq(s.revisions.entity, "team_lead")).all()
    expect(log.map((r) => r.action)).toEqual(["create", "create", "update"])
    removeLead(admin, dep.id)
    expect(listTeams(admin)[0].leads).toHaveLength(1)
  })
})
