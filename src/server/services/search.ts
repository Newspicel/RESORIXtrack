/**
 * Global search (⌘K). Only returns what the actor may see:
 * - people: HR → everyone; team leads → members of led teams; administrators → everyone (profile only);
 *   employees → nobody but themselves (they have no use for other people's records)
 * - projects: active projects (everyone books on them); teams: administrators and managers
 * Queries are prefix/substring LIKE with LIMIT; tables are small (people, projects, teams).
 */
import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm"
import { db } from "../db"
import { projects, teams, users } from "../db/schema"
import { type Actor, isManager } from "./permissions"

export interface SearchHit {
  kind: "person" | "project" | "team"
  id: number
  title: string
  subtitle: string
  color?: string
}

function pattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export function globalSearch(actor: Actor, rawQuery: string): SearchHit[] {
  const q = rawQuery.trim().slice(0, 80)
  if (q.length < 2) return []
  const p = pattern(q)
  const hits: SearchHit[] = []

  const personWhere = [
    eq(users.isActive, true),
    or(sql`${users.name} LIKE ${p} ESCAPE '\\'`, sql`${users.email} LIKE ${p} ESCAPE '\\'`),
  ]
  let scope: number[] | null | "none" = "none"
  if (actor.isHr || actor.isAdmin) scope = null
  else if (actor.ledTeamIds.size) scope = [...actor.ledTeamIds]
  if (scope !== "none") {
    const rows = db
      .select({ id: users.id, name: users.name, email: users.email, team: teams.name })
      .from(users)
      .leftJoin(teams, eq(teams.id, users.teamId))
      .where(and(...personWhere, ...(scope ? [inArray(users.teamId, scope)] : [])))
      .orderBy(asc(users.name))
      .limit(8)
      .all()
    for (const r of rows) hits.push({ kind: "person", id: r.id, title: r.name, subtitle: r.team ?? r.email })
  }

  for (const r of db
    .select({ id: projects.id, name: projects.name, code: projects.code, color: projects.color })
    .from(projects)
    .where(and(eq(projects.isActive, true), or(like(projects.name, p), like(projects.code, p))))
    .orderBy(asc(projects.name))
    .limit(6)
    .all())
    hits.push({ kind: "project", id: r.id, title: r.name, subtitle: r.code, color: r.color })

  if (actor.isAdmin || isManager(actor)) {
    for (const r of db
      .select({ id: teams.id, name: teams.name, color: teams.color })
      .from(teams)
      .where(like(teams.name, p))
      .orderBy(asc(teams.name))
      .limit(5)
      .all())
      hits.push({ kind: "team", id: r.id, title: r.name, subtitle: "", color: r.color })
  }
  return hits
}
