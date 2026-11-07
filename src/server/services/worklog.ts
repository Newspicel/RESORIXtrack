/**
 * Work log: what a person did on a day (free text, project or customer reference; a duration or exact
 * times). The company decides whether it is off, optional or required; "required" means at least
 * `worklog_required_percent` of each day's worked minutes must be described (checked per day in
 * accounts.computeDays, shown as a warning and blocking the month sign-off).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, max, ne } from "drizzle-orm"
import { db } from "../db"
import { type Project, projects, type User, type WorkLog, workLogs } from "../db/schema"
import { Conflict, Forbidden, NotFound, Validation } from "../errors"
import { addDays, iso, localToday, utcnow } from "../time"
import { computeDaysFrom, loadContext } from "./accounts"
import { ensureOpenDates } from "./locks"
import { type Actor, actorFromUser, canManageUser, canViewUser, getUserOr404, requireView } from "./permissions"
import { getProjectOr404, type ProjectView, serializeProjects, visibleProjects } from "./projects"
import { record, snapshot } from "./revisions"
import { getAllSettings } from "./settings"

export interface WorklogConfig {
  mode: "off" | "optional" | "required"
  percent: number
  projectRequired: boolean
}

export function worklogConfig(): WorklogConfig {
  const st = getAllSettings()
  return {
    mode: st.worklog_mode,
    percent: st.worklog_required_percent,
    projectRequired: st.worklog_project_required,
  }
}

/** Annotated minutes a day with `workedMin` needs; 0 unless the work log is required. */
export function requiredMinutes(workedMin: number, cfg: WorklogConfig = worklogConfig()): number {
  if (cfg.mode !== "required" || workedMin <= 0) return 0
  return Math.ceil((workedMin * cfg.percent) / 100 - 1e-9)
}

export interface WorklogItem {
  id: number
  userId: number
  date: string
  minutes: number
  startTime: string | null
  endTime: string | null
  customerRef: string
  note: string
  projectId: number | null
  project: ProjectView | null
  createdById: number | null
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export function serializeLogs(rows: WorkLog[]): WorklogItem[] {
  const ids = [...new Set(rows.map((w) => w.projectId).filter((x): x is number => x != null))]
  const byId = new Map(
    (ids.length ? db.select().from(projects).where(inArray(projects.id, ids)).all() : []).map(
      (p) => [p.id, p] as const,
    ),
  )
  const views = new Map(serializeProjects([...byId.values()]).map((v) => [v.id, v]))
  return rows.map((w) => ({
    id: w.id,
    userId: w.userId,
    date: w.date,
    minutes: w.minutes,
    startTime: w.startTime,
    endTime: w.endTime,
    customerRef: w.customerRef,
    note: w.note,
    projectId: w.projectId,
    project: w.projectId != null ? (views.get(w.projectId) ?? null) : null,
    createdById: w.createdById,
    isDeleted: w.isDeleted,
    createdAt: iso(w.createdAt),
    updatedAt: iso(w.updatedAt),
  }))
}

export function logsBetween(userId: number, start: string, end: string, includeDeleted = false): WorkLog[] {
  const conds = [eq(workLogs.userId, userId), gte(workLogs.date, start), lte(workLogs.date, end)]
  if (!includeDeleted) conds.push(eq(workLogs.isDeleted, false))
  return db
    .select()
    .from(workLogs)
    .where(and(...conds))
    .orderBy(asc(workLogs.date), asc(workLogs.startTime), asc(workLogs.id))
    .all()
}

export function listLogs(actor: Actor, userId: number, start: string, end: string, includeDeleted = false) {
  const owner = requireView(actor, userId)
  return {
    userId: owner.id,
    config: worklogConfig(),
    items: serializeLogs(logsBetween(owner.id, start, end, includeDeleted)),
  }
}

/** Customer references the person used in the last year, most recent first (form suggestions). */
export function recentCustomerRefs(user: User, limit = 50): string[] {
  const since = addDays(localToday(user.timezone), -365)
  const last = max(workLogs.date)
  return db
    .select({ ref: workLogs.customerRef, last, lastId: max(workLogs.id) })
    .from(workLogs)
    .where(
      and(
        eq(workLogs.userId, user.id),
        eq(workLogs.isDeleted, false),
        ne(workLogs.customerRef, ""),
        gte(workLogs.date, since),
      ),
    )
    .groupBy(workLogs.customerRef)
    .orderBy(desc(last), desc(max(workLogs.id)))
    .limit(limit)
    .all()
    .map((r) => r.ref)
}

// ------------------------------------------------------------------ writes

export interface WorklogInput {
  userId?: number | null
  date?: string
  minutes?: number | null
  startTime?: string | null
  endTime?: string | null
  projectId?: number | null
  customerRef?: string
  note?: string
  reason?: string
}

type Normalized = Pick<WorkLog, "date" | "minutes" | "startTime" | "endTime" | "projectId" | "customerRef" | "note">

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

function checkAccess(actor: Actor, owner: User): void {
  if (actor.id !== owner.id && !canManageUser(actor, owner)) {
    throw new Forbidden("You can only log work for yourself or for members of teams you lead")
  }
}

function pick<T>(input: T | undefined, fallback: T): T {
  return input !== undefined ? input : fallback
}

function normalize(actor: Actor, owner: User, input: WorklogInput, existing: WorkLog | null): Normalized {
  const cfg = worklogConfig()
  if (cfg.mode === "off") throw new Conflict("The work log is switched off", { code: "worklog_off" })
  const date = pick(input.date, existing?.date)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Validation("Date is required", { fields: { date: "required" } })
  if (date > localToday(owner.timezone))
    throw new Validation("The date is in the future", { fields: { date: "future" } })
  if (owner.employmentStart && date < owner.employmentStart) {
    throw new Validation("Before the employment start", { fields: { date: "not_employed" } })
  }
  // switching an item with times to a plain duration: the caller clears the times explicitly
  let startTime = pick(input.startTime, existing?.startTime ?? null)
  let endTime = pick(input.endTime, existing?.endTime ?? null)
  if ((startTime == null) !== (endTime == null)) {
    throw new Validation("Give both a start and an end time, or neither", {
      fields: { [endTime == null ? "endTime" : "startTime"]: "required" },
    })
  }
  let minutes: number
  if (startTime != null && endTime != null) {
    if (!TIME_RE.test(startTime)) throw new Validation("Invalid time", { fields: { startTime: "invalid" } })
    if (!TIME_RE.test(endTime)) throw new Validation("Invalid time", { fields: { endTime: "invalid" } })
    minutes = toMin(endTime) - toMin(startTime)
    if (minutes <= 0) throw new Validation("The end must be after the start", { fields: { endTime: "before_start" } })
    if (input.minutes != null && input.minutes !== minutes) {
      throw new Validation("The duration follows from the times", { fields: { minutes: "derived" } })
    }
    const s = startTime
    const e = endTime
    const others = db
      .select({ id: workLogs.id, startTime: workLogs.startTime, endTime: workLogs.endTime })
      .from(workLogs)
      .where(
        and(
          eq(workLogs.userId, owner.id),
          eq(workLogs.date, date),
          eq(workLogs.isDeleted, false),
          isNotNull(workLogs.startTime),
        ),
      )
      .all()
    if (others.some((o) => o.id !== existing?.id && o.startTime! < e && s < o.endTime!)) {
      throw new Conflict("Overlaps another item of this day", {
        code: "worklog_overlap",
        fields: { startTime: "overlap", endTime: "overlap" },
      })
    }
  } else {
    const m = pick(input.minutes, existing?.minutes ?? null)
    if (m == null || !Number.isInteger(m) || m < 1 || m > 1440) {
      throw new Validation("Duration must be between 1 minute and 24 hours", { fields: { minutes: "invalid" } })
    }
    minutes = m
    startTime = null
    endTime = null
  }
  const projectId = pick(input.projectId, existing?.projectId ?? null)
  const customerRef = (pick(input.customerRef, existing?.customerRef ?? "") ?? "").trim().slice(0, 60)
  if (projectId != null && customerRef) {
    throw new Validation("Choose a project or a customer reference, not both", { fields: { customerRef: "invalid" } })
  }
  let project: Project | null = null
  if (projectId != null) {
    project = getProjectOr404(projectId)
    const ownerActor = owner.id === actor.id ? actor : actorFromUser(owner)
    const allowed =
      actor.isHr || actor.caps.has("projects") || visibleProjects(ownerActor, true).some((p) => p.id === projectId)
    if (!allowed)
      throw new Validation("This project is not available for this person", { fields: { projectId: "invalid" } })
    if (!project.isActive && existing?.projectId !== project.id) {
      throw new Validation("This project is no longer active", { fields: { projectId: "inactive" } })
    }
  } else if (cfg.projectRequired && !customerRef) {
    throw new Validation("A project or a customer reference is required", { fields: { projectId: "required" } })
  }
  const note = (pick(input.note, existing?.note ?? "") ?? "").trim().slice(0, 2000)
  if (!note && !project && !customerRef) {
    throw new Validation("Describe what you did, or choose a project or a customer reference", {
      fields: { note: "required" },
    })
  }
  return { date, minutes, startTime, endTime, projectId, customerRef, note }
}

function visibleLog(actor: Actor, id: number): { log: WorkLog; owner: User } {
  const log = db.select().from(workLogs).where(eq(workLogs.id, id)).get()
  if (!log) throw new NotFound("Work log item not found")
  const owner = getUserOr404(log.userId)
  if (!canViewUser(actor, owner)) throw new NotFound("Work log item not found")
  return { log, owner }
}

export function addLog(actor: Actor, input: WorklogInput, source = "web"): WorklogItem {
  const owner = input.userId == null || input.userId === actor.id ? actor.user : requireView(actor, input.userId)
  checkAccess(actor, owner)
  const v = normalize(actor, owner, input, null)
  ensureOpenDates(owner, v.date)
  const now = utcnow()
  const w = db
    .insert(workLogs)
    .values({ userId: owner.id, ...v, createdById: actor.id, createdAt: now, updatedAt: now })
    .returning()
    .get()
  record({
    entity: "work_log",
    row: w,
    action: "create",
    actor,
    subjectUserId: owner.id,
    before: null,
    reason: input.reason,
    source,
  })
  return serializeLogs([w])[0]
}

export function updateLog(actor: Actor, id: number, input: WorklogInput, reason = "", source = "web"): WorklogItem {
  const { log, owner } = visibleLog(actor, id)
  checkAccess(actor, owner)
  if (log.isDeleted) throw new Conflict("This item was deleted", { code: "deleted" })
  const v = normalize(actor, owner, input, log)
  const [first, last] = [log.date, v.date].sort()
  ensureOpenDates(owner, first, last)
  const before = snapshot("work_log", log)
  if (JSON.stringify(snapshot("work_log", { ...log, ...v })) === JSON.stringify(before)) return serializeLogs([log])[0]
  const w = db
    .update(workLogs)
    .set({ ...v, updatedAt: utcnow() })
    .where(eq(workLogs.id, log.id))
    .returning()
    .get()
  record({ entity: "work_log", row: w, action: "update", actor, subjectUserId: owner.id, before, reason, source })
  return serializeLogs([w])[0]
}

export function deleteLog(actor: Actor, id: number, reason = "", source = "web"): void {
  const { log, owner } = visibleLog(actor, id)
  checkAccess(actor, owner)
  if (log.isDeleted) return
  ensureOpenDates(owner, log.date)
  const before = snapshot("work_log", log)
  const w = db
    .update(workLogs)
    .set({ isDeleted: true, updatedAt: utcnow() })
    .where(eq(workLogs.id, log.id))
    .returning()
    .get()
  record({ entity: "work_log", row: w, action: "delete", actor, subjectUserId: owner.id, before, reason, source })
}

// ------------------------------------------------------------------ requirement

/** Past days in [start, end] whose described minutes are below the required share (empty unless required). */
export function daysWithGaps(user: User, start: string, end: string): string[] {
  if (worklogConfig().mode !== "required") return []
  const ctx = loadContext(user, start, end, { includePending: false })
  return computeDaysFrom(ctx, { raw: true })
    .filter((d) => d.date < ctx.today && d.workedMin > 0 && !d.worklogOk)
    .map((d) => d.date)
}

export function firstMissingDay(user: User, daysBack = 14): string | null {
  const today = localToday(user.timezone)
  return daysWithGaps(user, addDays(today, -daysBack), addDays(today, -1))[0] ?? null
}
