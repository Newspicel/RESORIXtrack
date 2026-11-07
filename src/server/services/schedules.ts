/**
 * Versioned work schedules (contract data): a schedule is valid from `validFrom` until the next one starts.
 * Used by the schedule editor (admin person page and team member page), accounts, reports and import.
 */
import { and, asc, count, eq } from "drizzle-orm"
import { db } from "../db"
import { type User, WEEKDAYS, type Weekday, type WorkSchedule, workSchedules } from "../db/schema"
import { Conflict, Forbidden, NotFound, Validation } from "../errors"
import { localToday, weekday } from "../time"
import { ensureScheduleChangeAllowed } from "./locks"
import { type Actor, canEditSchedule, requireProfile } from "./permissions"
import { record, snapshot } from "./revisions"
import { getSetting } from "./settings"

export interface ScheduleInput {
  validFrom: string
  pensumPercent: number
  minutes: { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number }
}

export type ScheduleMinutes = ScheduleInput["minutes"]

const COLUMN = {
  mon: "minutesMon",
  tue: "minutesTue",
  wed: "minutesWed",
  thu: "minutesThu",
  fri: "minutesFri",
  sat: "minutesSat",
  sun: "minutesSun",
} as const satisfies Record<Weekday, keyof WorkSchedule>

export function schedulesOf(userId: number): WorkSchedule[] {
  return db
    .select()
    .from(workSchedules)
    .where(eq(workSchedules.userId, userId))
    .orderBy(asc(workSchedules.validFrom))
    .all()
}

/** The schedule valid on `day` (latest validFrom <= day) or null. `schedules` must be sorted by validFrom. */
export function scheduleOn(schedules: WorkSchedule[], day: string): WorkSchedule | null {
  let current: WorkSchedule | null = null
  for (const s of schedules) {
    if (s.validFrom <= day) current = s
    else break
  }
  return current
}

/** Scheduled minutes of a weekday (0 = Monday). */
export function minutesOnWeekday(s: WorkSchedule, wd: number): number {
  return s[COLUMN[WEEKDAYS[wd]]]
}

export function minutesOn(s: WorkSchedule, day: string): number {
  return minutesOnWeekday(s, weekday(day))
}

export function scheduleMinutes(s: WorkSchedule): ScheduleMinutes {
  return {
    mon: s.minutesMon,
    tue: s.minutesTue,
    wed: s.minutesWed,
    thu: s.minutesThu,
    fri: s.minutesFri,
    sat: s.minutesSat,
    sun: s.minutesSun,
  }
}

export function weeklyMinutes(s: WorkSchedule): number {
  return WEEKDAYS.reduce((sum, w) => sum + s[COLUMN[w]], 0)
}

/** Number of scheduled days per week (days with minutes > 0). */
export function workdaysPerWeek(s: WorkSchedule): number {
  return WEEKDAYS.filter((w) => s[COLUMN[w]] > 0).length
}

export function serializeSchedule(s: WorkSchedule) {
  return {
    id: s.id,
    userId: s.userId,
    validFrom: s.validFrom,
    pensumPercent: s.pensumPercent,
    minutes: scheduleMinutes(s),
    weeklyMinutes: weeklyMinutes(s),
  }
}
export type ScheduleView = ReturnType<typeof serializeSchedule>

/** Schedules of a person for the editor (profile access: HR, leads, administrators, the person). */
export function listSchedules(actor: Actor, userId: number): ScheduleView[] {
  requireProfile(actor, userId)
  return schedulesOf(userId).map(serializeSchedule)
}

/**
 * Everything the schedule editor needs: the versions, whether the actor may change them (HR; leads of the
 * person's team when `lead_can_edit_schedules`), the company full-time week for the quick fill and the
 * person's today (versions before it need a reason).
 */
export function scheduleEditor(actor: Actor, userId: number) {
  const target = requireProfile(actor, userId)
  return {
    schedules: schedulesOf(target.id).map(serializeSchedule),
    canEdit: canEditSchedule(actor, target),
    fulltimeWeeklyMinutes: getSetting("fulltime_weekly_minutes"),
    today: localToday(target.timezone),
  }
}
export type ScheduleEditorData = ReturnType<typeof scheduleEditor>

/** A change reaching into the past (before the person's today) needs a reason; the first version does not. */
function requireReasonForPast(target: User, validFrom: string, reason: string, first = false): void {
  if (first || reason.trim() || validFrom >= localToday(target.timezone)) return
  throw new Validation("A reason is required for changes in the past", { fields: { reason: "required" } })
}

function hasSchedules(userId: number): boolean {
  return (db.select({ n: count() }).from(workSchedules).where(eq(workSchedules.userId, userId)).get()?.n ?? 0) > 0
}

function validate(input: ScheduleInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom) || Number.isNaN(Date.parse(input.validFrom))) {
    throw new Validation("Invalid date", { fields: { validFrom: "invalid" } })
  }
  for (const w of WEEKDAYS) {
    const v = input.minutes[w]
    if (!Number.isInteger(v) || v < 0 || v > 1440) {
      throw new Validation("Daily minutes must be between 0 and 1440", { fields: { [`minutes.${w}`]: "invalid" } })
    }
  }
  if (!(input.pensumPercent > 0 && input.pensumPercent <= 100)) {
    throw new Validation("Employment level must be between 1 and 100 %", { fields: { pensumPercent: "invalid" } })
  }
}

function requireEditor(actor: Actor, userId: number): User {
  const target = requireProfile(actor, userId)
  if (!canEditSchedule(actor, target)) throw new Forbidden("Not allowed to change work schedules")
  return target
}

function columns(input: ScheduleInput) {
  const m = input.minutes
  return {
    validFrom: input.validFrom,
    pensumPercent: input.pensumPercent,
    minutesMon: m.mon,
    minutesTue: m.tue,
    minutesWed: m.wed,
    minutesThu: m.thu,
    minutesFri: m.fri,
    minutesSat: m.sat,
    minutesSun: m.sun,
  }
}

function getSchedule(id: number): WorkSchedule {
  const s = db.select().from(workSchedules).where(eq(workSchedules.id, id)).get()
  if (!s) throw new NotFound("Schedule not found")
  return s
}

function sameDay(userId: number, validFrom: string): WorkSchedule | undefined {
  return db
    .select()
    .from(workSchedules)
    .where(and(eq(workSchedules.userId, userId), eq(workSchedules.validFrom, validFrom)))
    .get()
}

function overwrite(actor: Actor, target: User, row: WorkSchedule, input: ScheduleInput, reason: string): WorkSchedule {
  const before = snapshot("schedule", row)
  const updated = db.update(workSchedules).set(columns(input)).where(eq(workSchedules.id, row.id)).returning().get()
  record({ entity: "schedule", row: updated, action: "update", actor, subjectUserId: target.id, before, reason })
  return updated
}

/** New version; a version starting on the same day is replaced rather than duplicated (as in v1). */
export function createSchedule(actor: Actor, userId: number, input: ScheduleInput, reason = ""): WorkSchedule {
  const target = requireEditor(actor, userId)
  validate(input)
  ensureScheduleChangeAllowed(target, input.validFrom)
  requireReasonForPast(target, input.validFrom, reason, !hasSchedules(target.id))
  const clash = sameDay(target.id, input.validFrom)
  if (clash) return overwrite(actor, target, clash, input, reason)
  const created = db
    .insert(workSchedules)
    .values({ userId: target.id, ...columns(input) })
    .returning()
    .get()
  record({ entity: "schedule", row: created, action: "create", actor, subjectUserId: target.id, before: null, reason })
  return created
}

export function updateSchedule(actor: Actor, scheduleId: number, input: ScheduleInput, reason = ""): WorkSchedule {
  const existing = getSchedule(scheduleId)
  const target = requireEditor(actor, existing.userId)
  validate(input)
  ensureScheduleChangeAllowed(target, input.validFrom)
  ensureScheduleChangeAllowed(target, existing.validFrom)
  const earliest = [input.validFrom, existing.validFrom].sort()[0]
  requireReasonForPast(target, earliest, reason)
  const clash = sameDay(target.id, input.validFrom)
  if (clash && clash.id !== existing.id) {
    throw new Conflict("Another version starts on this date", { fields: { validFrom: "taken" } })
  }
  return overwrite(actor, target, existing, input, reason)
}

export function deleteSchedule(actor: Actor, scheduleId: number, reason = ""): void {
  const s = getSchedule(scheduleId)
  const target = requireEditor(actor, s.userId)
  const n = db.select({ n: count() }).from(workSchedules).where(eq(workSchedules.userId, target.id)).get()?.n ?? 0
  if (n <= 1) throw new Conflict("A person needs at least one work schedule", { code: "last_schedule" })
  ensureScheduleChangeAllowed(target, s.validFrom)
  requireReasonForPast(target, s.validFrom, reason)
  const before = snapshot("schedule", s)
  record({ entity: "schedule", row: s, action: "delete", actor, subjectUserId: target.id, before, reason })
  db.delete(workSchedules).where(eq(workSchedules.id, s.id)).run()
}

/** Default Mon-Fri minutes for a pensum (company full-time week / 5). */
export function defaultScheduleMinutes(fulltimeWeeklyMinutes: number, pensum = 100): ScheduleMinutes {
  const daily = Math.round(((fulltimeWeeklyMinutes / 5) * pensum) / 100)
  return { mon: daily, tue: daily, wed: daily, thu: daily, fri: daily, sat: 0, sun: 0 }
}
