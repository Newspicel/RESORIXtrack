import { describe, expect, it } from "vitest"
import { makeAdmin, makeLead, makeTeam, makeUser } from "@/test/factories"
import { canManageUser, canViewProfile, canViewUser, loadActor, visibleUserIds } from "./permissions"

describe("permissions", () => {
  it("isolates employees, scopes leads, keeps admins away from time data", () => {
    const team = makeTeam()
    const other = makeTeam()
    const lead = makeUser()
    makeLead(team.id, lead.id)
    const member = makeUser({ teamId: team.id })
    const stranger = makeUser({ teamId: other.id })
    const admin = makeAdmin()
    const hr = makeUser({ capabilities: ["hr"] })

    const L = loadActor(lead.id)
    expect(canViewUser(L, member)).toBe(true)
    expect(canViewUser(L, stranger)).toBe(false)
    expect(canManageUser(L, member)).toBe(true)
    expect(canManageUser(L, L.user)).toBe(false)

    const E = loadActor(member.id)
    expect(canViewUser(E, stranger)).toBe(false)
    expect(visibleUserIds(E)).toEqual([member.id])

    const A = loadActor(admin.id)
    expect(canViewUser(A, member)).toBe(false)
    expect(canViewProfile(A, member)).toBe(true)

    expect(visibleUserIds(loadActor(hr.id))).toBeNull()
  })

  it("respects deputy validity periods", () => {
    const team = makeTeam()
    const deputy = makeUser()
    makeLead(team.id, deputy.id, { role: "deputy", validFrom: "2000-01-01", validTo: "2000-12-31" })
    expect(loadActor(deputy.id).ledTeamIds.size).toBe(0)
  })
})
