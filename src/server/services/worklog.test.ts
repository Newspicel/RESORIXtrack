import { beforeEach, describe, expect, it } from "vitest"
import { rawSqlite } from "@/server/db"
import { freeze } from "@/server/time"
import {
  loadActor,
  lockMonth,
  makeEntry,
  makeLead,
  makeSchedule,
  makeTeam,
  makeUser,
  withSettings,
} from "@/test/factories"
import { computeDays } from "./accounts"
import { listProjects, projectReport, saveProject } from "./projects"
import {
  addLog,
  daysWithGaps,
  deleteLog,
  firstMissingDay,
  listLogs,
  recentCustomerRefs,
  requiredMinutes,
  updateLog,
} from "./worklog"

const TODAY = "2026-11-05"

beforeEach(() => freeze("2026-11-05T14:00:00Z"))

function org() {
  const team = makeTeam()
  const other = makeTeam()
  const lead = makeUser({ name: "Lea" })
  makeLead(team.id, lead.id)
  const anna = makeUser({ name: "Anna", teamId: team.id })
  const carl = makeUser({ name: "Carl", teamId: other.id })
  const pm = makeUser({ name: "Pia", capabilities: ["projects"] })
  return { team, other, lead, anna, carl, pm }
}

describe("projects", () => {
  it("visibility and management", () => {
    const { team, other, lead, anna, carl, pm } = org()
    const L = loadActor(lead.id)
    const P = loadActor(pm.id)
    const company = saveProject(P, { name: "Internal", code: "4711" })
    const teamProject = saveProject(L, { name: "Team A work", teamId: team.id })
    expect(teamProject.canManage).toBe(true)
    expect(() => saveProject(L, { name: "Other", teamId: other.id })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    )
    expect(() => saveProject(L, { name: "Company" })).toThrow(expect.objectContaining({ code: "forbidden" }))
    expect(() => saveProject(loadActor(anna.id), { name: "Mine", teamId: team.id })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    )
    expect(() => saveProject(P, { name: "Internal" })).toThrow(expect.objectContaining({ code: "project_taken" }))
    expect(() => saveProject(P, { name: "X", color: "red" })).toThrow(
      expect.objectContaining({ fields: { color: "invalid" } }),
    )
    saveProject(P, { name: "Other team", teamId: other.id })
    expect(listProjects(loadActor(anna.id)).map((p) => p.name)).toEqual(["Internal", "Team A work"])
    expect(listProjects(loadActor(carl.id)).map((p) => p.name)).toEqual(["Internal", "Other team"])
    expect(listProjects(P).length).toBe(3)
    expect(saveProject(L, { isActive: false }, teamProject.id).isActive).toBe(false)
    expect(listProjects(loadActor(anna.id)).map((p) => p.name)).toEqual(["Internal"])
    expect(listProjects(loadActor(anna.id), true).map((p) => p.name)).toEqual(["Internal", "Team A work"])
    expect(saveProject(P, { code: "  AB-12  " }, company.id).code).toBe("AB-12")
  })
})

describe("work log", () => {
  it("CRUD with durations, permissions, revisions and locks", () => {
    const { lead, anna, carl, pm } = org()
    const A = loadActor(anna.id)
    const p = saveProject(loadActor(pm.id), { name: "Internal" })
    const item = addLog(A, { date: TODAY, minutes: 90, projectId: p.id, note: "Planning" })
    expect(item).toMatchObject({ minutes: 90, project: { name: "Internal" } })
    expect(() => addLog(A, { date: "2026-11-06", minutes: 10, note: "x" })).toThrow(
      expect.objectContaining({ fields: { date: "future" } }),
    )
    expect(() => addLog(A, { date: TODAY, minutes: 0, note: "x" })).toThrow(
      expect.objectContaining({ fields: { minutes: "invalid" } }),
    )
    expect(() => addLog(A, { date: TODAY, minutes: 10 })).toThrow(
      expect.objectContaining({ fields: { note: "required" } }),
    )
    expect(() => addLog(A, { date: "2024-12-31", minutes: 10, note: "x" })).toThrow(
      expect.objectContaining({ fields: { date: "not_employed" } }),
    )
    const L = loadActor(lead.id)
    expect(addLog(L, { userId: anna.id, date: TODAY, minutes: 15, note: "Added by lead" }).createdById).toBe(lead.id)
    expect(() => addLog(loadActor(carl.id), { userId: anna.id, date: TODAY, minutes: 15, note: "x" })).toThrow(
      expect.objectContaining({ code: "not_found" }),
    )
    expect(() => updateLog(loadActor(carl.id), item.id, { minutes: 5 })).toThrow(
      expect.objectContaining({ code: "not_found" }),
    )
    expect(updateLog(A, item.id, { minutes: 60 }, "typo").minutes).toBe(60)
    deleteLog(A, item.id, "dup")
    expect(listLogs(A, anna.id, TODAY, TODAY).items).toHaveLength(1)
    expect(listLogs(A, anna.id, TODAY, TODAY, true).items).toHaveLength(2)
    const revs = rawSqlite()
      .prepare("SELECT action FROM revisions WHERE entity = 'work_log' AND entity_id = ? ORDER BY id")
      .all(item.id)
    expect(revs).toEqual([{ action: "create" }, { action: "update" }, { action: "delete" }])

    const old = addLog(A, { date: "2026-10-30", minutes: 30, note: "Old" })
    lockMonth(anna.id, "2026-10")
    const locked = expect.objectContaining({ code: "period_signed_off" })
    expect(() => addLog(A, { date: "2026-10-29", minutes: 30, note: "x" })).toThrow(locked)
    expect(() => updateLog(A, old.id, { date: TODAY })).toThrow(locked)
    expect(() => deleteLog(A, old.id)).toThrow(locked)
    expect(() => rawSqlite().prepare("UPDATE work_logs SET note = 'x' WHERE id = ?").run(old.id)).toThrow(
      /period signed off/,
    )

    withSettings({ worklog_mode: "off" })
    expect(() => addLog(A, { date: TODAY, minutes: 10, note: "x" })).toThrow(
      expect.objectContaining({ code: "worklog_off" }),
    )
  })

  it("timed items derive the duration and must not overlap", () => {
    const { anna } = org()
    const A = loadActor(anna.id)
    const a = addLog(A, { date: TODAY, startTime: "08:00", endTime: "09:30", note: "Calls" })
    expect(a.minutes).toBe(90)
    expect(() => addLog(A, { date: TODAY, startTime: "09:00", endTime: "10:00", note: "x" })).toThrow(
      expect.objectContaining({ code: "worklog_overlap" }),
    )
    expect(() => addLog(A, { date: TODAY, startTime: "10:00", note: "x" })).toThrow(
      expect.objectContaining({ fields: { endTime: "required" } }),
    )
    expect(() => addLog(A, { date: TODAY, startTime: "11:00", endTime: "10:00", note: "x" })).toThrow(
      expect.objectContaining({ fields: { endTime: "before_start" } }),
    )
    expect(() => addLog(A, { date: TODAY, startTime: "10:00", endTime: "11:00", minutes: 30, note: "x" })).toThrow(
      expect.objectContaining({ fields: { minutes: "derived" } }),
    )
    expect(addLog(A, { date: TODAY, startTime: "09:30", endTime: "10:00", note: "adjacent" }).minutes).toBe(30)
    expect(updateLog(A, a.id, { startTime: "07:30" }).minutes).toBe(120)
    const plain = updateLog(A, a.id, { startTime: null, endTime: null, minutes: 45 })
    expect(plain).toMatchObject({ startTime: null, endTime: null, minutes: 45 })
  })

  it("customer reference instead of a project, project requirement, suggestions", () => {
    const { anna, pm } = org()
    const A = loadActor(anna.id)
    const p = saveProject(loadActor(pm.id), { name: "Internal" })
    expect(() => addLog(A, { date: TODAY, minutes: 10, projectId: p.id, customerRef: "C-1" })).toThrow(
      expect.objectContaining({ fields: { customerRef: "invalid" } }),
    )
    addLog(A, { date: "2026-11-02", minutes: 10, customerRef: "C-1" })
    addLog(A, { date: "2026-11-03", minutes: 10, customerRef: "C-2" })
    addLog(A, { date: "2026-11-04", minutes: 10, customerRef: "C-1" })
    expect(recentCustomerRefs(anna)).toEqual(["C-1", "C-2"])
    withSettings({ worklog_project_required: true })
    expect(() => addLog(A, { date: TODAY, minutes: 10, note: "x" })).toThrow(
      expect.objectContaining({ fields: { projectId: "required" } }),
    )
    const inactive = saveProject(loadActor(pm.id), { name: "Old", isActive: false })
    expect(() => addLog(A, { date: TODAY, minutes: 10, projectId: inactive.id })).toThrow(
      expect.objectContaining({ fields: { projectId: "inactive" } }),
    )
    const team = makeTeam()
    const foreign = saveProject(loadActor(pm.id), { name: "Foreign", teamId: team.id })
    expect(() => addLog(A, { date: TODAY, minutes: 10, projectId: foreign.id })).toThrow(
      expect.objectContaining({ fields: { projectId: "invalid" } }),
    )
  })

  it("required mode: per-day coverage, gaps and project report", () => {
    const { anna, pm } = org()
    makeSchedule(anna.id)
    const A = loadActor(anna.id)
    withSettings({ worklog_mode: "required", worklog_required_percent: 80 })
    makeEntry(anna.id, "2026-11-03T07:00:00.000000Z", "2026-11-03T11:00:00.000000Z")
    makeEntry(anna.id, "2026-11-04T07:00:00.000000Z", "2026-11-04T11:00:00.000000Z")
    const p = saveProject(loadActor(pm.id), { name: "Internal", code: "INT" })
    addLog(A, { date: "2026-11-03", minutes: 200, projectId: p.id })
    addLog(A, { date: "2026-11-04", minutes: 60, customerRef: "C-9" })
    expect(requiredMinutes(240)).toBe(192)
    const days = computeDays(anna, "2026-11-03", "2026-11-04")
    expect(days.map((d) => [d.worklogMin, d.worklogRequiredMin, d.worklogOk])).toEqual([
      [200, 192, true],
      [60, 192, false],
    ])
    expect(daysWithGaps(anna, "2026-11-01", "2026-11-05")).toEqual(["2026-11-04"])
    expect(firstMissingDay(anna)).toBe("2026-11-04")
    const report = projectReport([anna], "2026-11-01", "2026-11-30")
    expect(report.totalMin).toBe(260)
    expect(report.projects.map((r) => [r.kind, r.name, r.minutes])).toEqual([
      ["project", "Internal", 200],
      ["customer", "C-9", 60],
    ])
    expect(report.people[0]).toMatchObject({ name: "Anna", minutes: 260, byProject: { Internal: 200, "C-9": 60 } })
  })
})
