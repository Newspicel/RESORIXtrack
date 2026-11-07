/**
 * What time was spent on: a time entry carries a project. The company decides with
 * `project_mode` whether this is off, optional or required; "required" means every finished work entry of a
 * past day has one (checked per day in accounts.computeDays, shown as a warning and blocking the sign-off).
 * Legacy work log rows (signed-off months from 1.x and early 2.0) still count in reports and day coverage; their
 * customer references read as part of the note.
 */
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm"
import { db } from "../db"
import { type Project, projects, timeEntries, type User, workLogs } from "../db/schema"
import { Conflict, Validation } from "../errors"
import { addDays, localDateOf, localToday, nowInstant, rangeBoundsUtc, zone } from "../time"
import { computeDaysFrom, loadContext } from "./accounts"
import { lockedMonths } from "./locks"
import { type Actor, actorFromUser } from "./permissions"
import { getProjectOr404, visibleProjects } from "./projects"
import { getSetting } from "./settings"

export type ProjectMode = "off" | "optional" | "required"

export function projectMode(): ProjectMode {
  return getSetting("project_mode")
}

/** The project shown on an entry. */
export interface EntryProject {
  id: number
  name: string
  code: string
  color: string
  isActive: boolean
}

export function entryProjects(ids: (number | null)[]): Map<number, EntryProject> {
  const wanted = [...new Set(ids.filter((x): x is number => x != null))]
  if (!wanted.length) return new Map()
  return new Map(
    db
      .select({
        id: projects.id,
        name: projects.name,
        code: projects.code,
        color: projects.color,
        isActive: projects.isActive,
      })
      .from(projects)
      .where(inArray(projects.id, wanted))
      .all()
      .map((p) => [p.id, p]),
  )
}

export interface ProjectFields {
  projectId?: number | null
}

/**
 * The project of a new or changed entry. It must be visible to the owner and active (an inactive one stays on
 * entries that already have it).
 */
export function resolveProjectFields(
  actor: Actor,
  owner: User,
  input: ProjectFields,
  existing: { projectId: number | null } | null,
): { projectId: number | null } {
  const projectId = input.projectId !== undefined ? input.projectId : (existing?.projectId ?? null)
  if (projectId === (existing?.projectId ?? null)) return { projectId }
  if (projectMode() === "off" && projectId != null) {
    throw new Conflict("Projects are switched off", { code: "projects_off" })
  }
  if (projectId != null) checkProject(actor, owner, getProjectOr404(projectId))
  return { projectId }
}

function checkProject(actor: Actor, owner: User, project: Project): void {
  const ownerActor = owner.id === actor.id ? actor : actorFromUser(owner)
  const allowed =
    actor.isHr || actor.caps.has("projects") || visibleProjects(ownerActor, true).some((p) => p.id === project.id)
  if (!allowed)
    throw new Validation("This project is not available for this person", { fields: { projectId: "invalid" } })
  if (!project.isActive) throw new Validation("This project is no longer active", { fields: { projectId: "inactive" } })
}

// ------------------------------------------------------------------ requirement

/** Past days in [start, end] with work that has no project (empty unless projects are required). */
export function daysMissingProjects(user: User, start: string, end: string): string[] {
  if (projectMode() !== "required") return []
  const ctx = loadContext(user, start, end, { includePending: false })
  return computeDaysFrom(ctx, { raw: true })
    .filter((d) => !d.projectOk)
    .map((d) => d.date)
}

/** The oldest recent day still open for changes whose work lacks a required project. */
export function firstDayMissingProject(user: User, daysBack = 14): string | null {
  const today = localToday(user.timezone)
  const [start, end] = [addDays(today, -daysBack), addDays(today, -1)]
  const days = daysMissingProjects(user, start, end)
  if (!days.length) return null
  const locked = lockedMonths(user, start, end)
  return days.find((d) => !locked[d.slice(0, 7)]) ?? null
}

// ------------------------------------------------------------------ project items (reports, coverage)

/** Minutes of one person on one local day spent on a project. */
export interface ProjectItem {
  userId: number
  date: string
  projectId: number | null
  note: string
  minutes: number
  /** Local HH:MM; null for a legacy item recorded as a plain duration. */
  start: string | null
  end: string | null
}

const DAY_MS = 86_400_000
const hhmm = (ms: number, tz: string) =>
  Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone(tz)).toPlainTime().toString({
    smallestUnit: "minute",
  })

/**
 * Project time of the people in [from, to] (local days), oldest first: work entries with a project, split at local midnight (running ones count until now), plus legacy work log rows. Two queries.
 */
export function projectItems(people: Pick<User, "id" | "timezone">[], from: string, to: string): ProjectItem[] {
  if (!people.length) return []
  const ids = people.map((u) => u.id)
  const bounds = new Map(people.map((u) => [u.id, rangeBoundsUtc(from, to, u.timezone)]))
  const earliest = [...bounds.values()].reduce((a, [s]) => (s < a ? s : a), "9999")
  const latest = [...bounds.values()].reduce((a, [, e]) => (e > a ? e : a), "")
  const tzOf = new Map(people.map((u) => [u.id, u.timezone]))
  const fromAt = new Date(Date.parse(earliest) - DAY_MS).toISOString().replace("Z", "000Z")
  const rows = db
    .select({
      userId: timeEntries.userId,
      startAt: timeEntries.startAt,
      endAt: timeEntries.endAt,
      projectId: timeEntries.projectId,
      note: timeEntries.note,
    })
    .from(timeEntries)
    .where(
      and(
        inArray(timeEntries.userId, ids),
        eq(timeEntries.isDeleted, false),
        eq(timeEntries.kind, "work"),
        gte(timeEntries.startAt, fromAt),
        lt(timeEntries.startAt, latest),
        isNotNull(timeEntries.projectId),
      ),
    )
    .orderBy(timeEntries.startAt)
    .all()
  const now = nowInstant().epochMilliseconds
  const out: ProjectItem[] = []
  for (const r of rows) {
    const tz = tzOf.get(r.userId)!
    const [s0, e0] = bounds.get(r.userId)!
    let a = Math.max(Date.parse(r.startAt), Date.parse(s0))
    const end = Math.min(r.endAt ? Date.parse(r.endAt) : now, Date.parse(e0))
    while (a < end) {
      const date = localDateOf(new Date(a).toISOString(), tz)
      const next = Temporal.PlainDate.from(date)
        .add({ days: 1 })
        .toZonedDateTime({ timeZone: zone(tz) }).epochMilliseconds
      const b = Math.min(end, next)
      out.push({
        userId: r.userId,
        date,
        projectId: r.projectId,
        note: r.note,
        minutes: (b - a) / 60000,
        start: hhmm(a, tz),
        end: b === next ? "24:00" : hhmm(b, tz),
      })
      a = b
    }
  }
  const legacy = db
    .select()
    .from(workLogs)
    .where(
      and(
        inArray(workLogs.userId, ids),
        gte(workLogs.date, from),
        lt(workLogs.date, addDays(to, 1)),
        eq(workLogs.isDeleted, false),
      ),
    )
    .all()
  for (const w of legacy)
    out.push({
      userId: w.userId,
      date: w.date,
      projectId: w.projectId,
      note: legacyNote(w),
      minutes: w.minutes,
      start: w.startTime,
      end: w.endTime,
    })
  return out.sort((x, y) => x.date.localeCompare(y.date) || (x.start ?? "").localeCompare(y.start ?? ""))
}

/** A legacy item's customer reference, which entries no longer carry, joins its note. */
export const legacyNote = (w: { customerRef: string; note: string }): string =>
  [w.customerRef, w.note].filter(Boolean).join(" · ")
