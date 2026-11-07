/**
 * Projects people book work log items on. Company-wide projects (no team) and team projects. Team leads
 * manage the projects of the teams they lead; the `projects` capability manages all of them.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm"
import { db } from "../db"
import { type Project, projects, teams, type User, workLogs } from "../db/schema"
import { Conflict, Forbidden, NotFound, Validation } from "../errors"
import { iso, utcnow } from "../time"
import { type Actor, canManageProjects } from "./permissions"
import { record, snapshot } from "./revisions"
import { getSetting } from "./settings"

export interface ProjectView {
  id: number
  name: string
  code: string
  color: string
  description: string
  teamId: number | null
  teamName: string | null
  isActive: boolean
  canManage: boolean
  createdAt: string
}

export interface ProjectInput {
  name?: string
  code?: string
  color?: string
  description?: string
  teamId?: number | null
  isActive?: boolean
}

type Viewer = Pick<Actor, "isHr" | "caps" | "ledTeamIds"> & { user: Pick<User, "teamId"> }

function teamNames(ids: (number | null)[]): Map<number, string> {
  const wanted = [...new Set(ids.filter((x): x is number => x != null))]
  if (!wanted.length) return new Map()
  return new Map(
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, wanted))
      .all()
      .map((t) => [t.id, t.name]),
  )
}

export function serializeProjects(rows: Project[], actor?: Actor): ProjectView[] {
  const names = teamNames(rows.map((p) => p.teamId))
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    color: p.color,
    description: p.description,
    teamId: p.teamId,
    teamName: p.teamId != null ? (names.get(p.teamId) ?? null) : null,
    isActive: p.isActive,
    canManage: actor ? canManageProjects(actor, p.teamId) : false,
    createdAt: iso(p.createdAt),
  }))
}

/**
 * Projects a person may book time on: company-wide ones plus those of their own team and the teams they
 * lead; HR and the projects capability see all.
 */
export function visibleProjects(viewer: Viewer, includeInactive = false): Project[] {
  const conds = []
  if (!(viewer.caps.has("projects") || viewer.isHr)) {
    const ids = new Set(viewer.ledTeamIds)
    if (viewer.user.teamId != null) ids.add(viewer.user.teamId)
    conds.push(ids.size ? or(isNull(projects.teamId), inArray(projects.teamId, [...ids])) : isNull(projects.teamId))
  }
  if (!includeInactive) conds.push(eq(projects.isActive, true))
  return db
    .select()
    .from(projects)
    .where(and(...conds))
    .orderBy(desc(projects.isActive), asc(projects.name))
    .all()
}

export function listProjects(actor: Actor, includeInactive = false): ProjectView[] {
  return serializeProjects(visibleProjects(actor, includeInactive), actor)
}

export function getProjectOr404(id: number): Project {
  const p = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!p) throw new NotFound("Project not found")
  return p
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** Create (no `projectId`) or update a project. */
export function saveProject(actor: Actor, input: ProjectInput, projectId?: number): ProjectView {
  const existing = projectId != null ? getProjectOr404(projectId) : null
  const teamId = input.teamId !== undefined ? input.teamId : (existing?.teamId ?? null)
  if (!canManageProjects(actor, teamId) || (existing && !canManageProjects(actor, existing.teamId))) {
    throw new Forbidden("Team leads manage the projects of their own teams")
  }
  if (teamId != null && !db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).get()) {
    throw new Validation("Unknown team", { fields: { teamId: "invalid" } })
  }
  const name = (input.name ?? existing?.name ?? "").trim().slice(0, 120)
  if (!name) throw new Validation("Project name is required", { fields: { name: "required" } })
  const clash = db.select({ id: projects.id }).from(projects).where(eq(projects.name, name)).get()
  if (clash && clash.id !== existing?.id) {
    throw new Conflict("A project with this name already exists", { code: "project_taken", fields: { name: "taken" } })
  }
  const color = input.color ?? existing?.color ?? "#35a1cc"
  if (!COLOR_RE.test(color)) throw new Validation("Invalid colour", { fields: { color: "invalid" } })
  const values = {
    name,
    teamId,
    code: (input.code ?? existing?.code ?? "").trim().slice(0, 30),
    color,
    description: (input.description ?? existing?.description ?? "").trim().slice(0, 500),
    isActive: input.isActive ?? existing?.isActive ?? true,
  }
  if (!existing) {
    const p = db
      .insert(projects)
      .values({ ...values, createdById: actor.id })
      .returning()
      .get()
    record({ entity: "project", row: p, action: "create", actor, subjectUserId: null, before: null })
    return serializeProjects([p], actor)[0]
  }
  const before = snapshot("project", existing)
  const p = db
    .update(projects)
    .set({ ...values, updatedAt: utcnow() })
    .where(eq(projects.id, existing.id))
    .returning()
    .get()
  if (JSON.stringify(snapshot("project", p)) !== JSON.stringify(before)) {
    record({ entity: "project", row: p, action: "update", actor, subjectUserId: null, before })
  }
  return serializeProjects([p], actor)[0]
}

// ------------------------------------------------------------------ aggregation (reports)

export interface ProjectReportRow {
  key: string
  projectId: number | null
  customerRef: string
  kind: "project" | "customer" | "none"
  name: string | null
  code: string
  color: string
  teamName: string | null
  minutes: number
  items: number
  people: { userId: number; name: string; minutes: number }[]
}

export interface ProjectReport {
  start: string
  end: string
  projects: ProjectReportRow[]
  people: {
    userId: number
    name: string
    teamName: string | null
    minutes: number
    items: number
    byProject: Record<string, number>
  }[]
  totalMin: number
  company: string
}

/** Logged minutes per project (or customer reference) and person in [start, end]; deleted items excluded. */
export function projectReport(people: User[], start: string, end: string): ProjectReport {
  const ids = people.map((u) => u.id)
  const rows = ids.length
    ? db
        .select({ log: workLogs, project: projects })
        .from(workLogs)
        .leftJoin(projects, eq(projects.id, workLogs.projectId))
        .where(
          and(
            inArray(workLogs.userId, ids),
            gte(workLogs.date, start),
            lte(workLogs.date, end),
            eq(workLogs.isDeleted, false),
          ),
        )
        .all()
    : []
  const teamsById = teamNames([...people.map((u) => u.teamId), ...rows.map((r) => r.project?.teamId ?? null)])
  const byProject = new Map<string, { row: ProjectReportRow; perPerson: Map<number, number> }>()
  const byPerson = new Map<number, ProjectReport["people"][number]>(
    people.map((u) => [
      u.id,
      {
        userId: u.id,
        name: u.name,
        teamName: u.teamId != null ? (teamsById.get(u.teamId) ?? null) : null,
        minutes: 0,
        items: 0,
        byProject: {},
      },
    ]),
  )
  for (const { log: w, project: p } of rows) {
    const key = w.customerRef ? `customer:${w.customerRef}` : `project:${w.projectId ?? "none"}`
    let entry = byProject.get(key)
    if (!entry) {
      entry = {
        row: {
          key,
          projectId: w.projectId,
          customerRef: w.customerRef,
          kind: w.customerRef ? "customer" : p ? "project" : "none",
          name: w.customerRef || p?.name || null,
          code: p?.code ?? "",
          color: p?.color ?? "",
          teamName: p?.teamId != null ? (teamsById.get(p.teamId) ?? null) : null,
          minutes: 0,
          items: 0,
          people: [],
        },
        perPerson: new Map(),
      }
      byProject.set(key, entry)
    }
    entry.row.minutes += w.minutes
    entry.row.items++
    entry.perPerson.set(w.userId, (entry.perPerson.get(w.userId) ?? 0) + w.minutes)
    const person = byPerson.get(w.userId)
    if (person) {
      person.minutes += w.minutes
      person.items++
      const label = w.customerRef || p?.name || ""
      person.byProject[label] = (person.byProject[label] ?? 0) + w.minutes
    }
  }
  for (const { row, perPerson } of byProject.values())
    row.people = [...perPerson.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([userId, minutes]) => ({ userId, name: byPerson.get(userId)?.name ?? "", minutes }))
  const result = [...byProject.values()]
    .map((e) => e.row)
    .sort((a, b) => b.minutes - a.minutes || (a.name ?? "~").localeCompare(b.name ?? "~"))
  return {
    start,
    end,
    projects: result,
    people: [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)),
    totalMin: result.reduce((s, r) => s + r.minutes, 0),
    company: getSetting("company_name"),
  }
}
