/**
 * Monthly sign-off of a person's time data (port of v1 services/signoffs.py). A signed month is immutable for
 * everyone until HR reopens it with a logged reason. Protection: services check services/locks.ts, SQLite
 * triggers enforce it again, and every sign-off is sealed (services/seals.ts): `digest` fingerprints all time
 * rows of the period, `seal` is an HMAC over the record chained to the person's previous seal.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm"
import type { z } from "zod"
import { isRecord, toJsonObject } from "@/lib/guards"
import type { JsonObject } from "@/lib/json"
import { db, MIGRATIONS_DIR, rawSqlite } from "../db"
import { mergeLegacyWorklogs } from "../db/legacy-worklogs"
import {
  absences,
  type MonthSignoff,
  monthSignoffs,
  revisions,
  teams,
  timeEntries,
  type User,
  users,
} from "../db/schema"
import { AppError, Conflict, Forbidden, NotFound, Validation } from "../errors"
import { addDays, dayBoundsUtc, iso, localToday, monthBounds, utcnow } from "../time"
import { userNames } from "./absences"
import { computeDays, type Summary, summarize, timeBalance } from "./accounts"
import { notify } from "./notifications"
import { deferMail } from "./outbox"
import { type Actor, canViewUser, getUserOr404, isManager, leadsUser, requireView, visibleUserIds } from "./permissions"
import { daysMissingProjects } from "./project-time"
import {
  checkUserChain,
  computeDigest,
  computeSeal,
  jcs,
  lastSeal,
  periodData,
  SEAL_VERSION,
  type SealCheck,
} from "./seals"

export { listSignoffsInput, monthString, overviewInput, signInput } from "./signoffs.schemas"

import { listSignoffsInput, monthString, overviewInput, signInput } from "./signoffs.schemas"

export type Blocker =
  | "month_not_complete"
  | "running_entry"
  | "pending_absence"
  | "already_signed"
  | "not_employed"
  | "projects_missing"
export type Integrity = "intact" | "figures_changed" | "data_changed" | "seal_invalid" | "chain_broken"

const BLOCKER_MESSAGES: Record<Blocker, string> = {
  month_not_complete: "The month is not over yet",
  running_entry: "There is a running time entry",
  pending_absence: "There are absence requests waiting for a decision",
  projects_missing: "Some work has no project",
  already_signed: "This month is already signed off",
  not_employed: "The person was not employed in this month",
}

// ------------------------------------------------------------------ periods

export function parseMonth(month: string): [number, number] {
  if (!monthString.safeParse(month).success)
    throw new Validation("Month must be YYYY-MM", { fields: { month: "invalid" } })
  return [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
}

export function monthPeriod(user: Pick<User, "timezone">, month: string) {
  const [y, m] = parseMonth(month)
  const [start, end] = monthBounds(y, m)
  return { start, end, startUtc: dayBoundsUtc(start, user.timezone)[0], endUtc: dayBoundsUtc(end, user.timezone)[1] }
}

export function previousMonth(tz: string): string {
  return addDays(`${localToday(tz).slice(0, 7)}-01`, -1).slice(0, 7)
}

function activeSignoff(userId: number, month: string): MonthSignoff | undefined {
  return db
    .select()
    .from(monthSignoffs)
    .where(and(eq(monthSignoffs.userId, userId), eq(monthSignoffs.month, month), isNull(monthSignoffs.reopenedAt)))
    .get()
}

// ------------------------------------------------------------------ rules

/** Leads/deputies sign their members; HR signs anyone. Never one's own month. */
export function canSign(actor: Actor, target: User): boolean {
  if (actor.id === target.id) return false
  return actor.isHr || leadsUser(actor, target)
}

/** Why the month cannot be signed off yet (compliance findings never block). */
export function blockers(user: User, month: string): Blocker[] {
  const { start, end, endUtc } = monthPeriod(user, month)
  const out: Blocker[] = []
  if (end >= localToday(user.timezone)) out.push("month_not_complete")
  const running = db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, user.id),
        isNull(timeEntries.endAt),
        eq(timeEntries.isDeleted, false),
        lt(timeEntries.startAt, endUtc),
      ),
    )
    .limit(1)
    .get()
  if (running) out.push("running_entry")
  const pending = db
    .select({ id: absences.id })
    .from(absences)
    .where(
      and(
        eq(absences.userId, user.id),
        eq(absences.status, "pending"),
        lte(absences.startDate, end),
        gte(absences.endDate, start),
      ),
    )
    .limit(1)
    .get()
  if (pending) out.push("pending_absence")
  if (activeSignoff(user.id, month)) out.push("already_signed")
  if ((user.employmentStart && end < user.employmentStart) || (user.employmentEnd && start > user.employmentEnd))
    out.push("not_employed")
  if (!out.includes("month_not_complete") && daysMissingProjects(user, start, end).length) out.push("projects_missing")
  return out
}

// ------------------------------------------------------------------ figures

/** Stored snapshot figures: fixed since v1 (digests depend on them); newer summary fields stay out. */
type SignedFigure = Exclude<
  keyof Summary,
  | "workedCompleteMin"
  | "todayWorkedMin"
  | "todayTargetMin"
  | "sundayWorkMin"
  | "holidayWorkMin"
  | "nightWorkMin"
  | "surchargeMin"
  | "nightCreditMin"
>
const SNAPSHOT_FIGURES = {
  scheduledMin: "scheduled_min",
  targetMin: "target_min",
  targetTotalMin: "target_total_min",
  workedMin: "worked_min",
  creditMin: "credit_min",
  deltaMin: "delta_min",
  vacationDays: "vacation_days",
  workdays: "workdays",
} as const satisfies Record<SignedFigure, string>
const isFigure = (key: string): key is keyof typeof SNAPSHOT_FIGURES => Object.hasOwn(SNAPSHOT_FIGURES, key)

/** Figures compared by the integrity check (snake_case keys as stored since v1). */
const CHECKED_FIGURES = ["target_min", "worked_min", "delta_min"] as const

function monthSummary(user: User, start: string, end: string): Summary {
  return summarize(computeDays(user, start, end))
}

function snapshotOf(summary: Summary, extra: JsonObject): JsonObject {
  const out: JsonObject = {}
  for (const [k, v] of Object.entries(summary)) if (isFigure(k)) out[SNAPSHOT_FIGURES[k]] = v
  return { ...out, ...extra }
}

export function parseSnapshot(row: Pick<MonthSignoff, "snapshot">): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(row.snapshot)
    return isRecord(v) ? v : {}
  } catch {
    return {}
  }
}

/** Signed figures in the API's camelCase form. */
export function snapshotFigures(row: Pick<MonthSignoff, "snapshot">) {
  const s = parseSnapshot(row)
  const num = (k: string) => {
    const v = s[k]
    return typeof v === "number" ? v : null
  }
  return {
    scheduledMin: num("scheduled_min"),
    targetMin: num("target_min"),
    targetTotalMin: num("target_total_min"),
    workedMin: num("worked_min"),
    creditMin: num("credit_min"),
    deltaMin: num("delta_min"),
    vacationDays: num("vacation_days"),
    workdays: num("workdays"),
    balanceEndMin: num("balance_end_min"),
    timezone: typeof s.timezone === "string" ? s.timezone : null,
    userName: typeof s.user_name === "string" ? s.user_name : null,
    signedByName: typeof s.signed_by_name === "string" ? s.signed_by_name : null,
  }
}

// ------------------------------------------------------------------ sign off / reopen

function logSignoff(actor: Actor, row: MonthSignoff, action: "signoff" | "reopen", reason: string): void {
  db.insert(revisions)
    .values({
      entity: "signoff",
      entityId: row.id,
      subjectUserId: row.userId,
      actorId: actor.id,
      action,
      before: null,
      after: { month: row.month, digest: row.digest, seal: row.seal },
      reason: reason.trim().slice(0, 500),
      source: "web",
    })
    .run()
}

export function signOff(actor: Actor, user: User, month: string, note = ""): MonthSignoff {
  if (!canSign(actor, user)) {
    throw new Forbidden(
      actor.id === user.id
        ? "Your own month must be signed off by another lead or by HR"
        : "You can only sign off members of teams you lead",
    )
  }
  const problems = blockers(user, month)
  if (problems.length) {
    throw new Conflict(problems.map((p) => BLOCKER_MESSAGES[p]).join("; "), {
      code: problems[0],
      fields: { blockers: problems },
    })
  }
  const { start, end, startUtc, endUtc } = monthPeriod(user, month)
  const snapshot = jcs(
    snapshotOf(monthSummary(user, start, end), {
      balance_end_min: timeBalance(user, end).balanceMin,
      timezone: user.timezone,
      user_name: user.name,
      signed_by_name: actor.user.name,
    }),
  )
  const base = {
    userId: user.id,
    month,
    periodStartDate: start,
    periodEndDate: end,
    periodStartUtc: startUtc,
    periodEndUtc: endUtc,
    signedById: actor.id,
    signedAt: utcnow(),
    note: note.trim().slice(0, 500),
    snapshot,
    digest: computeDigest(SEAL_VERSION, periodData(user.id, start, end, startUtc, endUtc, SEAL_VERSION)),
    prevSeal: lastSeal(user.id),
    sealVersion: SEAL_VERSION,
  }
  const row = db
    .insert(monthSignoffs)
    .values({ ...base, seal: computeSeal(base) })
    .returning()
    .get()
  logSignoff(actor, row, "signoff", note)
  notify(user.id, "month_signed_off", { month, actor_name: actor.user.name, signoff_id: row.id })
  deferMail({ email: user.email, name: user.name, locale: user.locale }, "month_signed_off", {
    user_name: user.name,
    actor_name: actor.user.name,
    month,
  })
  return row
}

export interface SignResult {
  userId: number
  ok: boolean
  signoff?: SignoffDto
  error?: { code: string; message: string; fields?: JsonObject }
}

/** Sign off one month for several people; each person succeeds or fails on their own (savepoint per person). */
export function signOffMany(actor: Actor, raw: z.input<typeof signInput>): SignResult[] {
  const input = signInput.parse(raw)
  const results: SignResult[] = []
  for (const userId of [...new Set(input.userIds)].sort((a, b) => a - b)) {
    const target = db.select().from(users).where(eq(users.id, userId)).get()
    if (!target || !canViewUser(actor, target)) {
      results.push({ userId, ok: false, error: { code: "not_found", message: "User not found" } })
      continue
    }
    try {
      const row = rawSqlite().transaction(() => signOff(actor, target, input.month, input.note))()
      results.push({ userId, ok: true, signoff: serializeSignoffs([row])[0] })
    } catch (err) {
      if (!(err instanceof AppError)) throw err
      results.push({
        userId,
        ok: false,
        error: { code: err.code, message: err.message, ...(err.fields ? { fields: toJsonObject(err.fields) } : {}) },
      })
    }
  }
  return results
}

export function getSignoff(id: number): MonthSignoff {
  const row = db.select().from(monthSignoffs).where(eq(monthSignoffs.id, id)).get()
  if (!row) throw new NotFound("Sign-off not found")
  return row
}

export function reopen(actor: Actor, id: number, reason: string): MonthSignoff {
  const row = getSignoff(id)
  const owner = getUserOr404(row.userId)
  if (!canViewUser(actor, owner) && !actor.isAdmin) throw new NotFound("Sign-off not found")
  if (!actor.isHr) throw new Forbidden("Only HR can reopen a signed-off month")
  if (row.reopenedAt != null) throw new Conflict("This sign-off was already reopened", { code: "invalid_state" })
  const why = reason.trim().slice(0, 500)
  if (!why) throw new Validation("A reason is required", { fields: { reason: "required" } })
  const updated = db
    .update(monthSignoffs)
    .set({ reopenedAt: utcnow(), reopenedById: actor.id, reopenReason: why })
    .where(eq(monthSignoffs.id, id))
    .returning()
    .get()
  logSignoff(actor, updated, "reopen", why)
  // the month's legacy work log rows can move onto its entries now
  mergeLegacyWorklogs(rawSqlite(), row.userId)
  for (const targetId of new Set([row.userId, row.signedById])) {
    if (targetId != null && targetId !== actor.id) {
      notify(targetId, "month_reopened", {
        month: row.month,
        actor_name: actor.user.name,
        reason: why,
        user_name: owner.name,
        user_id: owner.id,
      })
    }
  }
  return updated
}

// ------------------------------------------------------------------ verification

const CHECK_TO_INTEGRITY: Record<SealCheck, Integrity> = {
  ok: "intact",
  seal_mismatch: "seal_invalid",
  digest_mismatch: "data_changed",
  chain_broken: "chain_broken",
}

/** Integrity per sign-off id of one person; `figures_changed` = rows untouched but a rule changed the live figures. */
export function verifyUser(userId: number): Map<number, Integrity> {
  const checks = checkUserChain(userId)
  const out = new Map<number, Integrity>()
  if (!checks.size) return out
  const rows = new Map(
    db
      .select()
      .from(monthSignoffs)
      .where(eq(monthSignoffs.userId, userId))
      .all()
      .map((r) => [r.id, r]),
  )
  const user = db.select().from(users).where(eq(users.id, userId)).get()
  for (const [id, check] of checks) {
    const r = rows.get(id)!
    let status = CHECK_TO_INTEGRITY[check]
    if (status === "intact" && r.reopenedAt == null && user) {
      const snap = parseSnapshot(r)
      const live = snapshotOf(monthSummary(user, r.periodStartDate, r.periodEndDate), {})
      const changed = CHECKED_FIGURES.some((k) => {
        const a = snap[k]
        const b = live[k]
        return typeof a === "number" && typeof b === "number" && Math.abs(a - b) > 0.005
      })
      if (changed) status = "figures_changed"
    }
    out.set(id, status)
  }
  return out
}

let guardNames: string[] | null = null
/** Trigger names the guard migration installs. */
export function expectedGuards(): string[] {
  guardNames ??= [
    ...readFileSync(path.join(MIGRATIONS_DIR, "0001_guards.sql"), "utf8").matchAll(
      /CREATE TRIGGER IF NOT EXISTS (\w+)/g,
    ),
  ].map((m) => m[1])
  return guardNames
}

export function installedGuards(): Set<string> {
  return new Set(
    rawSqlite()
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all()
      .map((r) => r.name),
  )
}

/** Whole-database integrity check (HR; administrators get the result without the signed figures). */
export function verifyAll(actor: Actor, userId?: number | null) {
  if (!actor.isHr && !actor.isAdmin) throw new Forbidden("HR or administrators only")
  const q = db.selectDistinct({ userId: monthSignoffs.userId }).from(monthSignoffs)
  const ids = (userId != null ? q.where(eq(monthSignoffs.userId, userId)) : q).all().map((r) => r.userId)
  const counts: Record<Integrity, number> = {
    intact: 0,
    figures_changed: 0,
    data_changed: 0,
    seal_invalid: 0,
    chain_broken: 0,
  }
  const problems: { id: number; status: Integrity }[] = []
  for (const uid of ids) {
    for (const [id, status] of verifyUser(uid)) {
      counts[status]++
      if (status !== "intact") problems.push({ id, status })
    }
  }
  const rows = problems.length
    ? db
        .select()
        .from(monthSignoffs)
        .where(
          inArray(
            monthSignoffs.id,
            problems.map((p) => p.id),
          ),
        )
        .all()
    : []
  const statusById = new Map(problems.map((p) => [p.id, p.status]))
  const present = installedGuards()
  const missing = expectedGuards().filter((n) => !present.has(n))
  return {
    counts,
    problems: serializeSignoffs(rows, (r) => statusById.get(r.id) ?? null).map((p) =>
      actor.isHr ? p : Object.assign(p, { figures: null }),
    ),
    guards: { expected: expectedGuards().length, missing },
    ok: problems.length === 0 && missing.length === 0,
  }
}

// ------------------------------------------------------------------ queries

export function serializeSignoffs(rows: MonthSignoff[], integrity?: (r: MonthSignoff) => Integrity | null) {
  const names = userNames(rows.flatMap((r) => [r.userId, r.signedById, r.reopenedById]))
  const ref = (id: number | null) => (id != null ? { id, name: names.get(id) ?? "" } : null)
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: names.get(r.userId) ?? null,
    month: r.month,
    periodStart: r.periodStartDate,
    periodEnd: r.periodEndDate,
    signedBy: ref(r.signedById),
    signedAt: iso(r.signedAt),
    note: r.note,
    figures: snapshotFigures(r) as ReturnType<typeof snapshotFigures> | null,
    digest: r.digest,
    sealVersion: r.sealVersion,
    active: r.reopenedAt == null,
    reopenedAt: iso(r.reopenedAt),
    reopenedBy: ref(r.reopenedById),
    reopenReason: r.reopenReason,
    integrity: integrity?.(r) ?? null,
  }))
}
export type SignoffDto = ReturnType<typeof serializeSignoffs>[number]

export function listSignoffs(actor: Actor, raw: z.input<typeof listSignoffsInput> = {}) {
  const input = listSignoffsInput.parse(raw)
  const conds = []
  const visible = visibleUserIds(actor)
  if (visible) conds.push(inArray(monthSignoffs.userId, visible))
  if (input.userId != null) {
    requireView(actor, input.userId)
    conds.push(eq(monthSignoffs.userId, input.userId))
  }
  if (input.month) conds.push(eq(monthSignoffs.month, input.month))
  const rows = db
    .select()
    .from(monthSignoffs)
    .where(and(...conds))
    .orderBy(desc(monthSignoffs.month), desc(monthSignoffs.id))
    .limit(500)
    .all()
  return serializeSignoffs(rows)
}

export function signoffDetail(actor: Actor, id: number) {
  const row = getSignoff(id)
  requireView(actor, row.userId)
  const status = actor.isHr ? (verifyUser(row.userId).get(row.id) ?? null) : null
  return serializeSignoffs([row], () => status)[0]
}

/** Active sign-offs of `month` for these people (team views show "signed" badges). */
export function monthStatus(userIds: number[], month: string): Map<number, MonthSignoff> {
  if (!userIds.length) return new Map()
  const rows = db
    .select()
    .from(monthSignoffs)
    .where(
      and(inArray(monthSignoffs.userId, userIds), eq(monthSignoffs.month, month), isNull(monthSignoffs.reopenedAt)),
    )
    .all()
  return new Map(rows.map((r) => [r.userId, r]))
}

/** People in scope for a period: active ones plus leavers whose employment reached into it. */
export function scopeUsers(
  actor: Actor,
  opts: { teamId?: number | null; userId?: number | null; periodStart?: string | null } = {},
): User[] {
  const conds = [
    opts.periodStart
      ? or(eq(users.isActive, true), and(isNotNull(users.employmentEnd), gte(users.employmentEnd, opts.periodStart)))!
      : eq(users.isActive, true),
  ]
  const visible = visibleUserIds(actor)
  if (visible) conds.push(inArray(users.id, visible))
  if (opts.teamId != null) conds.push(eq(users.teamId, opts.teamId))
  if (opts.userId != null) conds.push(eq(users.id, opts.userId))
  return db
    .select()
    .from(users)
    .where(and(...conds))
    .orderBy(asc(users.name), asc(users.id))
    .all()
}

/** For leads and HR: each person's month figures, sign-off state and blockers. */
export function signoffOverview(actor: Actor, raw: z.input<typeof overviewInput> = {}) {
  if (!isManager(actor)) throw new Forbidden("Only team leads and HR can sign off months")
  const input = overviewInput.parse(raw)
  const month = input.month ?? previousMonth(actor.user.timezone)
  const [y, m] = parseMonth(month)
  const [start, end] = monthBounds(y, m)
  const people = scopeUsers(actor, { teamId: input.teamId, periodStart: start }).filter(
    (u) => !u.employmentStart || u.employmentStart <= end,
  )
  const signed = monthStatus(
    people.map((u) => u.id),
    month,
  )
  const dtos = new Map(serializeSignoffs([...signed.values()]).map((d) => [d.userId, d]))
  const teamIds = [...new Set(people.map((u) => u.teamId).filter((x): x is number => x != null))]
  const teamNames = new Map(
    teamIds.length
      ? db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, teamIds))
          .all()
          .map((t) => [t.id, t.name])
      : [],
  )
  const rows = people.map((u) => {
    const active = signed.get(u.id)
    return {
      user: {
        id: u.id,
        name: u.name,
        teamId: u.teamId,
        teamName: u.teamId != null ? (teamNames.get(u.teamId) ?? null) : null,
      },
      summary: monthSummary(u, start, end),
      signoff: dtos.get(u.id) ?? null,
      blockers: blockers(u, month).filter((b) => b !== "already_signed"),
      canSign: canSign(actor, u) && !active,
    }
  })
  return { month, rows }
}
