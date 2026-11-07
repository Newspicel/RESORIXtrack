/**
 * The REST API v1 (prefix /api/v1). Handlers are thin: they resolve the subject person, check the key's scope
 * and call the same services as the web app with the key's owner as actor.
 *
 * - Reading another person's data (`?userId=`, or a record id of someone else) additionally needs
 *   `reports:read`; the services then decide visibility (out of scope answers 404).
 * - Writes act on the owner's own records only; corrections of others stay in the web app.
 */
import { asc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { isOneOf } from "@/lib/guards"
import { db } from "../db"
import { absences, appState, teams, timeEntries, type User, users } from "../db/schema"
import { Forbidden, NotFound, Validation } from "../errors"
import { tx } from "../middleware"
import { listAbsenceTypes, requestableTypes } from "../services/absence-types"
import { cancelAbsence, createAbsence, getAbsenceDto, listAbsences, serializeAbsences } from "../services/absences"
import { computeDaysFrom, loadContext, summarize, timeBalance, vacationAccount } from "../services/accounts"
import { type ClockAction, clockAction, clockState, syncOffline } from "../services/clock"
import { createEntry, deleteEntry, getEntry, listEntries, updateEntry } from "../services/entries"
import { withOutbox } from "../services/outbox"
import { type Actor, isManager, requireView, visibleUserIds } from "../services/permissions"
import { timesheet } from "../services/reports"
import { getSetting } from "../services/settings"
import { localToday, utcnow } from "../time"
import { requireScope } from "./auth"
import { type Ctx, type Endpoint, endpoint } from "./endpoint"
import * as S from "./schemas"

// ------------------------------------------------------------------ helpers

/** The person a read is about: the key's owner, or (with `reports:read`) someone the owner may see. */
function subject(ctx: Ctx<unknown, unknown>, userId: number | null | undefined): User {
  if (userId == null || userId === ctx.actor.id) return ctx.actor.user
  requireScope(ctx.caller, "reports:read")
  return requireView(ctx.actor, userId)
}

/** A record of someone else needs `reports:read` (visibility was already checked by the service). */
function foreignRecord(ctx: Ctx<unknown, unknown>, ownerId: number): void {
  if (ownerId !== ctx.actor.id) requireScope(ctx.caller, "reports:read")
}

function ownRow(table: typeof timeEntries | typeof absences, actor: Actor, id: number, what: string): void {
  const row = db.select({ userId: table.userId }).from(table).where(eq(table.id, id)).get()
  if (!row || row.userId !== actor.id) throw new NotFound(`${what} not found`)
}

function checkRange(from: string, to: string, maxDays = 400): void {
  if (to < from) throw new Validation("'to' is before 'from'", { fields: { to: "before_start" } })
  if (Temporal.PlainDate.from(from).until(to).days > maxDays)
    throw new Validation(`Range too large (max ${maxDays} days)`, { fields: { to: "too_long" } })
}

const encodeCursor = (key: string) => Buffer.from(key).toString("base64url")
function decodeCursor(cursor: string): string {
  const key = Buffer.from(cursor, "base64url").toString()
  if (!key || encodeCursor(key) !== cursor) throw new Validation("Invalid cursor", { fields: { cursor: "invalid" } })
  return key
}
const pad = (n: number) => String(n).padStart(12, "0")

/** Keyset pagination over items already sorted by `key`. */
export function page<T>(items: T[], key: (t: T) => string, limit: number, cursor?: string) {
  const after = cursor ? decodeCursor(cursor) : null
  const rest = after == null ? items : items.filter((i) => key(i) > after)
  const slice = rest.slice(0, limit)
  return { items: slice, nextCursor: rest.length > limit ? encodeCursor(key(slice[slice.length - 1])) : null }
}

const range = { from: S.day, to: S.day }
const userQuery = {
  userId: S.qId.optional().meta({ description: "Another visible person (needs `reports:read`)." }),
}
const instantInput = z
  .string()
  .min(10)
  .max(40)
  .meta({
    format: "date-time",
    description: "ISO 8601 instant (UTC `Z` or with offset).",
    examples: ["2026-11-05T07:58:00Z"],
  })

// ------------------------------------------------------------------ me, people

const me = endpoint({
  method: "GET",
  path: "/me",
  tag: "Me",
  summary: "Who the key belongs to",
  scope: null,
  response: S.Me,
  handler: ({ actor, caller }) => ({
    id: actor.id,
    name: actor.user.name,
    email: actor.user.email,
    timezone: actor.user.timezone,
    locale: actor.user.locale,
    teamId: actor.user.teamId,
    isAdmin: actor.isAdmin,
    isHr: actor.isHr,
    isLead: actor.ledTeamIds.size > 0,
    scopes: [...caller.scopes].sort(),
    company: { name: getSetting("company_name"), timezone: getSetting("default_timezone") },
  }),
})

const listUsers = endpoint({
  method: "GET",
  path: "/users",
  tag: "People",
  summary: "People whose data the owner may see",
  description: "Team leads and deputies: their teams. HR: everyone. Others: 403.",
  scope: "reports:read",
  query: z.object({ limit: S.qLimit, cursor: S.qCursor }),
  response: S.pageOf(S.Person),
  handler: ({ actor, query }) => {
    if (!isManager(actor)) throw new Forbidden("Only team leads and HR can list people")
    const visible = visibleUserIds(actor)
    const rows = db
      .select({ u: users, teamName: teams.name })
      .from(users)
      .leftJoin(teams, eq(teams.id, users.teamId))
      .where(visible ? inArray(users.id, visible) : undefined)
      .orderBy(asc(users.id))
      .all()
      .filter((r) => !r.u.anonymizedAt)
    const people = rows.map(({ u, teamName }) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      teamId: u.teamId,
      teamName,
      timezone: u.timezone,
      isActive: u.isActive,
    }))
    return page(people, (p) => pad(p.id), query.limit, query.cursor)
  },
})

// ------------------------------------------------------------------ clock

const clockBody = z.object({
  at: instantInput.optional().meta({ description: "When it happened (offline clients); at most 48 h back." }),
  clientId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .meta({ description: "Client-generated id (uuid). A repeated id is answered without changing anything." }),
  note: z.string().max(500).optional(),
})

const offlineKey = (userId: number, clientId: string) => `offline:${userId}:${clientId}`

function clockWithId(ctx: Ctx<unknown, z.output<typeof clockBody>>, action: ClockAction) {
  const { actor, body } = ctx
  return tx(() => {
    const key = body.clientId ? offlineKey(actor.id, body.clientId) : null
    if (key && db.select({ k: appState.key }).from(appState).where(eq(appState.key, key)).get())
      return { ...clockState(actor.user), replayed: true }
    const state = clockAction(actor, action, { at: body.at, note: body.note, source: ctx.caller.source })
    if (key)
      db.insert(appState)
        .values({ key, value: JSON.stringify({ id: body.clientId, status: "applied" }), updatedAt: utcnow() })
        .run()
    return { ...state, replayed: false }
  })
}

const CLOCK_PATHS = [
  ["in", "start", "Clock in"],
  ["break", "break", "Start a break"],
  ["resume", "resume", "End the break"],
  ["out", "stop", "Clock out"],
] as const

const clockActions = CLOCK_PATHS.map(([path, action, summary]) =>
  endpoint({
    method: "POST",
    path: `/clock/${path}`,
    tag: "Clock",
    summary,
    description:
      "Idempotent: repeating the current state's action changes nothing. Refused outside the employment period (409 employment_ended) and in signed-off months (409 period_signed_off).",
    scope: "time:write",
    body: clockBody,
    response: S.ClockResult,
    handler: (ctx) => clockWithId(ctx, action),
  }),
)

const clockSyncAction = z.enum(["in", "break", "resume", "out"])
const ACTION_OF: Record<z.output<typeof clockSyncAction>, ClockAction> = {
  in: "start",
  break: "break",
  resume: "resume",
  out: "stop",
}

const clockSync = endpoint({
  method: "POST",
  path: "/clock/sync",
  tag: "Clock",
  summary: "Replay actions recorded offline",
  description:
    "Applies the actions in order. Each `clientId` is applied at most once (remembered for 30 days); rejected actions are reported per id and not retried.",
  scope: "time:write",
  body: z.object({
    actions: z
      .array(
        z.object({
          clientId: z.string().min(1).max(64),
          action: clockSyncAction,
          at: instantInput,
          note: z.string().max(500).optional(),
        }),
      )
      .min(1)
      .max(200),
  }),
  response: z.object({
    results: z.array(
      z.object({
        clientId: z.string(),
        status: z.enum(["applied", "duplicate", "rejected"]),
        code: z.string().optional(),
      }),
    ),
    clock: S.ClockState,
  }),
  handler: ({ actor, body }) => {
    const out = tx(() =>
      syncOffline(
        actor,
        body.actions.map((a) => ({ id: a.clientId, action: ACTION_OF[a.action], at: a.at, note: a.note })),
      ),
    )
    return { results: out.results.map(({ id, ...r }) => ({ clientId: id, ...r })), clock: out.clock }
  },
})

const getClock = endpoint({
  method: "GET",
  path: "/clock",
  tag: "Clock",
  summary: "Current clock state and today's totals",
  scope: "time:read",
  response: S.ClockState,
  handler: ({ actor }) => clockState(actor.user),
})

// ------------------------------------------------------------------ days, entries

const days = endpoint({
  method: "GET",
  path: "/days",
  tag: "Time",
  summary: "Per-day target, worked time, absences (max 400 days)",
  scope: "time:read",
  query: z.object({ ...range, ...userQuery }),
  response: S.DaysResult,
  handler: (ctx) => {
    const user = subject(ctx, ctx.query.userId)
    checkRange(ctx.query.from, ctx.query.to)
    const list = computeDaysFrom(loadContext(user, ctx.query.from, ctx.query.to))
    return {
      user: { id: user.id, name: user.name, timezone: user.timezone },
      from: ctx.query.from,
      to: ctx.query.to,
      days: list,
      summary: summarize(list),
    }
  },
})

const listEntriesEp = endpoint({
  method: "GET",
  path: "/entries",
  tag: "Time",
  summary: "Time entries in a date range (max 400 days)",
  scope: "time:read",
  query: z.object({
    ...range,
    ...userQuery,
    includeDeleted: S.qBool.optional(),
    limit: S.qLimit,
    cursor: S.qCursor,
  }),
  response: S.pageOf(S.Entry),
  handler: (ctx) => {
    const { query } = ctx
    const user = subject(ctx, query.userId)
    checkRange(query.from, query.to)
    const items = listEntries(ctx.actor, user.id, query.from, query.to, query.includeDeleted ?? false)
    return page(items, (e) => `${e.startAt}#${pad(e.id)}`, query.limit, query.cursor)
  },
})

const getEntryEp = endpoint({
  method: "GET",
  path: "/entries/{id}",
  tag: "Time",
  summary: "One time entry",
  scope: "time:read",
  response: S.Entry,
  handler: (ctx) => {
    const e = getEntry(ctx.actor, ctx.id)
    foreignRecord(ctx, e.userId)
    return e
  },
})

const reason = z.string().max(500).default("").meta({ description: "Required for changes to past days." })

const createEntryEp = endpoint({
  method: "POST",
  path: "/entries",
  tag: "Time",
  summary: "Add a time entry (forgot to clock)",
  scope: "time:write",
  body: z.object({
    kind: z.enum(["work", "break"]).default("work"),
    startAt: instantInput,
    endAt: instantInput,
    note: z.string().max(500).default(""),
    reason,
  }),
  response: S.Entry,
  status: 201,
  handler: ({ actor, body, caller }) =>
    withOutbox(() => tx(() => createEntry(actor, { ...body, source: caller.source }))),
})

const updateEntryEp = endpoint({
  method: "PATCH",
  path: "/entries/{id}",
  tag: "Time",
  summary: "Change an own time entry",
  scope: "time:write",
  body: z.object({
    kind: z.enum(["work", "break"]).optional(),
    startAt: instantInput.optional(),
    endAt: instantInput.optional(),
    note: z.string().max(500).optional(),
    reason,
  }),
  response: S.Entry,
  handler: ({ actor, id, body: { reason: why, ...changes }, caller }) =>
    withOutbox(() =>
      tx(() => {
        ownRow(timeEntries, actor, id, "Entry")
        return updateEntry(actor, id, changes, why, caller.source)
      }),
    ),
})

const deleteEntryEp = endpoint({
  method: "DELETE",
  path: "/entries/{id}",
  tag: "Time",
  summary: "Delete an own time entry",
  description: "Soft delete: the entry stays in the change history.",
  scope: "time:write",
  body: z.object({ reason }),
  response: null,
  handler: ({ actor, id, body, caller }) =>
    withOutbox(() =>
      tx(() => {
        ownRow(timeEntries, actor, id, "Entry")
        deleteEntry(actor, id, body.reason, caller.source)
      }),
    ),
})

// ------------------------------------------------------------------ accounts

const balance = endpoint({
  method: "GET",
  path: "/balance",
  tag: "Accounts",
  summary: "Overtime balance",
  scope: "time:read",
  query: z.object(userQuery),
  response: S.Balance,
  handler: (ctx) => {
    const user = subject(ctx, ctx.query.userId)
    return { userId: user.id, ...timeBalance(user) }
  },
})

const vacation = endpoint({
  method: "GET",
  path: "/vacation",
  tag: "Accounts",
  summary: "Vacation account of a year",
  scope: "absences:read",
  query: z.object({ year: S.qYear.optional().meta({ description: "Default: current year" }), ...userQuery }),
  response: S.Vacation,
  handler: (ctx) => {
    const user = subject(ctx, ctx.query.userId)
    return vacationAccount(user, ctx.query.year ?? Number(localToday(user.timezone).slice(0, 4)))
  },
})

// ------------------------------------------------------------------ absences

const absenceTypes = endpoint({
  method: "GET",
  path: "/absence-types",
  tag: "Absences",
  summary: "Active absence types",
  scope: "absences:read",
  response: z.object({ items: z.array(S.AbsenceType) }),
  handler: ({ actor }) => {
    const requestable = new Set(requestableTypes(actor).map((t) => t.id))
    return {
      items: listAbsenceTypes({ activeOnly: true }).map((t) =>
        Object.assign(t, { requestable: requestable.has(t.id) }),
      ),
    }
  },
})

const STATUSES = ["pending", "approved", "rejected", "cancelled"] as const

const listAbsencesEp = endpoint({
  method: "GET",
  path: "/absences",
  tag: "Absences",
  summary: "Absences overlapping a date range (max 2 years)",
  scope: "absences:read",
  query: z.object({
    ...range,
    ...userQuery,
    status: z
      .string()
      .optional()
      .meta({ description: "Comma-separated: pending, approved, rejected, cancelled" })
      .transform((v, c) => {
        if (!v) return null
        const list = v.split(",").map((s) => s.trim())
        const statuses = list.filter((s) => isOneOf(STATUSES, s))
        if (statuses.length !== list.length) c.addIssue({ code: "custom", message: "invalid" })
        return statuses
      }),
    limit: S.qLimit,
    cursor: S.qCursor,
  }),
  response: S.pageOf(S.Absence),
  handler: (ctx) => {
    const { query } = ctx
    const user = subject(ctx, query.userId)
    checkRange(query.from, query.to, 731)
    const rows = listAbsences(ctx.actor, { from: query.from, to: query.to, userId: user.id, status: query.status })
    const sorted = [...rows].sort((a, b) =>
      a.startDate === b.startDate ? a.id - b.id : a.startDate < b.startDate ? -1 : 1,
    )
    return page(sorted, (a) => `${a.startDate}#${pad(a.id)}`, query.limit, query.cursor)
  },
})

const getAbsenceEp = endpoint({
  method: "GET",
  path: "/absences/{id}",
  tag: "Absences",
  summary: "One absence",
  scope: "absences:read",
  response: S.Absence,
  handler: (ctx) => {
    const a = getAbsenceDto(ctx.actor, ctx.id)
    foreignRecord(ctx, a.user.id)
    return a
  },
})

const half = z.enum(["full", "am", "pm"]).default("full")

const createAbsenceEp = endpoint({
  method: "POST",
  path: "/absences",
  tag: "Absences",
  summary: "Request an absence",
  description: "Types that need approval start as `pending`; the team lead decides in the web app.",
  scope: "absences:write",
  body: z.object({
    type: z
      .union([z.number().int().positive(), z.string().min(1).max(32)])
      .meta({ description: "Type id or key, e.g. `vacation`" }),
    startDate: S.day,
    endDate: S.day.optional(),
    startHalf: half,
    endHalf: half,
    note: z.string().max(1000).default(""),
  }),
  response: S.Absence,
  status: 201,
  handler: ({ actor, body, caller }) =>
    withOutbox(() => tx(() => serializeAbsences(actor, [createAbsence(actor, body, caller.source)])[0])),
})

const cancelAbsenceEp = endpoint({
  method: "POST",
  path: "/absences/{id}/cancel",
  tag: "Absences",
  summary: "Cancel an own absence",
  scope: "absences:write",
  body: z.object({ reason: z.string().max(1000).default("") }),
  response: S.Absence,
  handler: ({ actor, id, body, caller }) =>
    withOutbox(() =>
      tx(() => {
        ownRow(absences, actor, id, "Absence")
        return serializeAbsences(actor, [cancelAbsence(actor, id, body.reason, caller.source)])[0]
      }),
    ),
})

// ------------------------------------------------------------------ reports

const timesheetEp = endpoint({
  method: "GET",
  path: "/reports/timesheet",
  tag: "Reports",
  summary: "Monthly timesheet",
  scope: "reports:read",
  query: z.object({ month: S.month, ...userQuery }),
  response: S.Timesheet,
  handler: (ctx) => {
    const user = subject(ctx, ctx.query.userId)
    const [year, month] = ctx.query.month.split("-").map(Number)
    return timesheet(ctx.actor, { userId: user.id, year, month })
  },
})

/** Every endpoint, in documentation order. */
export const ENDPOINTS: Endpoint[] = [
  me,
  listUsers,
  getClock,
  ...clockActions,
  clockSync,
  days,
  listEntriesEp,
  getEntryEp,
  createEntryEp,
  updateEntryEp,
  deleteEntryEp,
  balance,
  vacation,
  absenceTypes,
  listAbsencesEp,
  getAbsenceEp,
  createAbsenceEp,
  cancelAbsenceEp,
  timesheetEp,
]

export const TAGS = ["Me", "People", "Clock", "Time", "Accounts", "Absences", "Reports"] as const
