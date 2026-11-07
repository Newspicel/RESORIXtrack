/**
 * The clock state machine (idle -> working <-> on_break -> idle), port of v1 services/entries.py.
 *
 * - Actions are idempotent: repeating the current state's action is a no-op (double clicks, retries).
 * - `at` backdates an action (offline sync, or a time chosen by hand with `custom`, which marks the entry
 *   as manual): not in the future, at most 48 h back, never before the running entry started.
 * - Offline sync replays queued actions with client action ids; ids already processed are skipped.
 * - The partial unique index `uq_time_entries_open` guarantees one running entry per person even under
 *   concurrent requests; a lost race answers `already_running`.
 */
import { and, eq, gt, isNull, like, lt, max } from "drizzle-orm"
import { db, rawSqlite } from "../db"
import { appState, type TimeEntry, timeEntries, type User } from "../db/schema"
import { AppError, Conflict, Validation } from "../errors"
import { dayBoundsUtc, iso, localDateOf, localToday, nowInstant, utcnow } from "../time"
import {
  type EntrySource,
  type EntryView,
  entriesBetween,
  instantOfMs,
  MAX_ENTRY_MS,
  ms,
  parseInstantInput,
  type RevisionSource,
  serializeEntry,
} from "./entries"
import { ensureOpenInstants } from "./locks"
import type { Actor } from "./permissions"
import { record, snapshot } from "./revisions"

export { CLOCK_ACTIONS } from "./clock.schemas"

import { CLOCK_ACTIONS } from "./clock.schemas"

export type ClockAction = (typeof CLOCK_ACTIONS)[number]
export type ClockStateName = "idle" | "working" | "on_break"

const FUTURE_TOLERANCE_MS = 2 * 60_000
const BACKDATE_NOTE_AFTER_MS = 15 * 60_000
const CLOCK_BACKDATE_LIMIT_MS = 48 * 3600_000
const RAPID_MS = 5000
const OFFLINE_KEEP_DAYS = 30

export interface ClockState {
  state: ClockStateName
  entry: EntryView | null
  since: string | null
  todayWorkedMin: number
  todayBreakMin: number
  serverTime: string
}

export function openEntry(userId: number): TimeEntry | undefined {
  return db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endAt), eq(timeEntries.isDeleted, false)))
    .get()
}

const stateOf = (e: TimeEntry | undefined): ClockStateName =>
  e == null ? "idle" : e.kind === "work" ? "working" : "on_break"

export function clockState(user: User): ClockState {
  const e = openEntry(user.id)
  const [s, en] = dayBoundsUtc(localToday(user.timezone), user.timezone)
  const now = nowInstant().epochMilliseconds
  let worked = 0
  let breaks = 0
  for (const t of entriesBetween(user.id, s, en)) {
    const a = Math.max(ms(t.startAt), ms(s))
    const b = Math.min(t.endAt ? ms(t.endAt) : now, ms(en))
    const mins = Math.max(0, (b - a) / 60000)
    if (t.kind === "work") worked += mins
    else breaks += mins
  }
  return {
    state: stateOf(e),
    entry: e ? serializeEntry(e) : null,
    since: e ? iso(e.startAt) : null,
    todayWorkedMin: Math.round(worked * 100) / 100,
    todayBreakMin: Math.round(breaks * 100) / 100,
    serverTime: iso(utcnow()),
  }
}

function ensureEmployed(user: User, at: string): void {
  const day = localDateOf(at, user.timezone)
  if (user.employmentEnd && day > user.employmentEnd) {
    throw new Conflict("Employment has ended; the clock can no longer be used", { code: "employment_ended" })
  }
  if (user.employmentStart && day < user.employmentStart) {
    throw new Conflict("Employment has not started yet", { code: "not_employed" })
  }
}

/** Effective time (epoch ms, whole seconds) of an action. */
function clockTime(at: string | null, current: TimeEntry | undefined): number {
  const now = nowInstant().epochMilliseconds
  let t = now
  if (at != null) {
    const a = ms(at)
    if (a > now + FUTURE_TOLERANCE_MS) throw new Validation("Clock time is in the future", { fields: { at: "future" } })
    if (a < now - CLOCK_BACKDATE_LIMIT_MS) {
      throw new Validation("Clock time is too far in the past; add an entry instead", { fields: { at: "too_old" } })
    }
    t = Math.min(a, now)
  }
  t = Math.floor(t / 1000) * 1000
  if (current && t < ms(current.startAt)) {
    // rapid clicks: entries are kept >= 1 s apart
    if (at == null || ms(current.startAt) - t <= RAPID_MS) return ms(current.startAt)
    throw new Conflict("Clock time is before the current entry started", { code: "clock_order" })
  }
  return t
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: time_entries/.test(err.message)
}

function startNew(actor: Actor, kind: "work" | "break", t0: number, source: RevisionSource, note = ""): TimeEntry {
  const user = actor.user
  let t = t0
  ensureOpenInstants(user, instantOfMs(t))
  ensureEmployed(user, instantOfMs(t))
  const at = instantOfMs(t)
  const later = db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, user.id),
        eq(timeEntries.isDeleted, false),
        gt(timeEntries.startAt, instantOfMs(t - MAX_ENTRY_MS - 3600_000)),
        gt(timeEntries.endAt, at),
      ),
    )
    .limit(1)
    .get()
  if (later) {
    const latestEnd = db
      .select({ v: max(timeEntries.endAt) })
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, user.id), eq(timeEntries.isDeleted, false)))
      .get()?.v
    if (latestEnd && ms(latestEnd) - t <= RAPID_MS && ms(later.startAt) <= t) t = ms(latestEnd)
    else
      throw new Conflict("Clock time overlaps an existing entry", {
        code: "overlap",
        fields: { overlaps: serializeEntry(later) },
      })
  }
  const entrySource: EntrySource = source === "web" ? "clock" : source
  const now = utcnow()
  let e: TimeEntry
  try {
    e = db
      .insert(timeEntries)
      .values({
        userId: user.id,
        kind,
        startAt: instantOfMs(t),
        endAt: null,
        tz: user.timezone,
        note: note.trim().slice(0, 500),
        source: entrySource,
        createdById: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
  } catch (err) {
    if (isUniqueViolation(err)) throw new Conflict("The clock is already running", { code: "already_running" })
    throw err
  }
  const backdated = nowInstant().epochMilliseconds - t > BACKDATE_NOTE_AFTER_MS
  record({
    entity: "time_entry",
    row: e,
    action: "create",
    actor,
    subjectUserId: user.id,
    before: null,
    source,
    reason: backdated ? "offline sync: clocked with an earlier time" : "",
  })
  return e
}

/** Close the open entry at `t`; returns the effective end (the next entry starts there). */
function close(actor: Actor, e: TimeEntry, t0: number, source: RevisionSource): number {
  let t = t0
  ensureOpenInstants(actor.user, instantOfMs(t))
  const backdated = nowInstant().epochMilliseconds - t > BACKDATE_NOTE_AFTER_MS
  const before = snapshot("time_entry", e)
  const start = ms(e.startAt)
  if (t <= start) t = start + 1000 // start and stop within the same second
  if (t - start > MAX_ENTRY_MS) t = start + MAX_ENTRY_MS
  const updated = db
    .update(timeEntries)
    .set({
      endAt: instantOfMs(t),
      updatedAt: utcnow(),
      // an end chosen by hand ("clock out with a custom time") is shown as manual, not as a punch
      ...(source === "manual" ? { source: "manual" as const } : {}),
    })
    .where(eq(timeEntries.id, e.id))
    .returning()
    .get()
  record({
    entity: "time_entry",
    row: updated,
    action: "update",
    actor,
    subjectUserId: actor.id,
    before,
    reason: backdated ? "clock (offline sync: earlier time)" : "clock",
    source,
  })
  return t
}

export interface ClockOptions {
  /** ISO instant, or local wall-clock time in the person's timezone. */
  at?: string | null
  /** The time was chosen by hand: the entry is marked as manual. */
  custom?: boolean
  note?: string
  /** web (default) | api | desktop | offline */
  source?: RevisionSource
}

export function clockAction(actor: Actor, action: ClockAction, opts: ClockOptions = {}): ClockState {
  const user = actor.user
  if (!CLOCK_ACTIONS.includes(action)) throw new Validation("Unknown clock action", { fields: { action: "invalid" } })
  const current = openEntry(user.id)
  const state = stateOf(current)
  const noop =
    (action === "start" && state === "working") ||
    (action === "break" && state === "on_break") ||
    (action === "resume" && state === "working") ||
    (action === "stop" && state === "idle")
  if (noop) return clockState(user)
  if (action === "break" && state === "idle") throw new Conflict("You are not clocked in", { code: "not_working" })
  if (action === "resume" && state === "idle") throw new Conflict("You are not on a break", { code: "not_on_break" })
  const at = opts.at ? parseInstantInput(opts.at, user.timezone) : null
  const source: RevisionSource = opts.custom && at ? "manual" : (opts.source ?? "web")
  const t = clockTime(at, current)
  if (action === "start" && state === "idle") startNew(actor, "work", t, source, opts.note ?? "")
  else if (action === "stop") close(actor, current!, t, source)
  else if (action === "break") startNew(actor, "break", close(actor, current!, t, source), source)
  else startNew(actor, "work", close(actor, current!, t, source), source) // start/resume from a break
  return clockState(user)
}

/** Close a running entry now (used when an account is deactivated). */
export function stopRunning(user: User, actor: Actor | null, reason = ""): TimeEntry | null {
  const e = openEntry(user.id)
  if (!e) return null
  const before = snapshot("time_entry", e)
  const end = Math.max(Math.floor(nowInstant().epochMilliseconds / 1000) * 1000, ms(e.startAt) + 1000)
  const updated = db
    .update(timeEntries)
    .set({ endAt: instantOfMs(end), updatedAt: utcnow() })
    .where(eq(timeEntries.id, e.id))
    .returning()
    .get()
  record({ entity: "time_entry", row: updated, action: "update", actor, subjectUserId: user.id, before, reason })
  return updated
}

// ------------------------------------------------------------------ offline sync

export interface OfflineAction {
  /** Client-generated id of the queued action (uuid). */
  id: string
  action: ClockAction
  /** When the action happened on the device (ISO instant). */
  at: string
  note?: string
}

export interface OfflineResult {
  id: string
  status: "applied" | "duplicate" | "rejected"
  code?: string
}

const offlineKey = (userId: number, id: string) => `offline:${userId}:${id}`

/**
 * Replays queued clock actions in order, each in its own savepoint. Processed ids are remembered for
 * 30 days, so a retried upload applies nothing twice. Rejected actions (e.g. overlap, signed-off month) are
 * reported per id and not retried.
 */
export function syncOffline(actor: Actor, actions: OfflineAction[]): { results: OfflineResult[]; clock: ClockState } {
  const cutoff = instantOfMs(nowInstant().epochMilliseconds - OFFLINE_KEEP_DAYS * 86_400_000)
  db.delete(appState)
    .where(and(like(appState.key, "offline:%"), lt(appState.updatedAt, cutoff)))
    .run()
  const results: OfflineResult[] = []
  for (const a of actions) {
    const key = offlineKey(actor.id, a.id)
    if (db.select({ k: appState.key }).from(appState).where(eq(appState.key, key)).get()) {
      results.push({ id: a.id, status: "duplicate" })
      continue
    }
    let result: OfflineResult
    try {
      rawSqlite().transaction(() => clockAction(actor, a.action, { at: a.at, note: a.note, source: "offline" }))()
      result = { id: a.id, status: "applied" }
    } catch (err) {
      if (!(err instanceof AppError)) throw err
      result = { id: a.id, status: "rejected", code: err.code }
    }
    db.insert(appState)
      .values({ key, value: JSON.stringify(result), updatedAt: utcnow() })
      .run()
    results.push(result)
  }
  return { results, clock: clockState(actor.user) }
}
