/**
 * Report data (port of v1 services/reports.py builders): monthly timesheet, balances, absences, project
 * hours and the raw entry export. Builders return plain JSON data; rendering (PDF, XLSX, CSV) is separate.
 * Scope: employees their own data, leads their teams, HR everyone (permissions.visibleUserIds).
 */
import { and, eq, inArray } from "drizzle-orm"
import type { z } from "zod"
import { db } from "../db"
import { monthSignoffs, projects, teams, type User, type WorkLog } from "../db/schema"
import { Forbidden, Validation } from "../errors"
import { addDays, dayBoundsUtc, iso, localToday, monthBounds, rangeBoundsUtc } from "../time"
import { absenceTypesById } from "./absence-types"
import { absencesInRange, clippedDays, minDay, userNames } from "./absences"
import { computeDays, summarize, timeBalance, vacationAccount } from "./accounts"
import { editedEntryIds, entriesBetween } from "./entries"
import { type Actor, isManager, requireView } from "./permissions"
import { getAllSettings, getSetting } from "./settings"
import { scopeUsers } from "./signoffs"
import { logsBetween, worklogConfig } from "./worklog"

export { balancesInput, rangeInput, timesheetInput } from "./reports.schemas"

import { balancesInput, rangeInput, timesheetInput } from "./reports.schemas"

function checkRange(from: string, to: string): void {
  if (to < from) throw new Validation("'to' is before 'from'", { fields: { to: "before_start" } })
  if (Temporal.PlainDate.from(from).until(to).days > 731)
    throw new Validation("Range too large (max 2 years)", { fields: { to: "too_long" } })
}

const localTime = (at: string, tz: string) =>
  Temporal.Instant.from(at).toZonedDateTimeISO(tz).toPlainTime().toString({ smallestUnit: "minute" })
const localDate = (at: string, tz: string) => Temporal.Instant.from(at).toZonedDateTimeISO(tz).toPlainDate().toString()
const emptyCounts = (): Record<string, number> => ({})

function pushTo<T>(map: Record<string, T[]>, key: string, item: T): void {
  map[key] = [...(map[key] ?? []), item]
}
const round = (x: number, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits

function teamNameMap(people: Pick<User, "teamId">[]): Map<number, string> {
  const ids = [...new Set(people.map((u) => u.teamId).filter((x): x is number => x != null))]
  if (!ids.length) return new Map()
  return new Map(
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, ids))
      .all()
      .map((t) => [t.id, t.name]),
  )
}

function projectMap(logs: WorkLog[]) {
  const ids = [...new Set(logs.map((w) => w.projectId).filter((x): x is number => x != null))]
  const rows = ids.length ? db.select().from(projects).where(inArray(projects.id, ids)).all() : []
  const teamsById = teamNameMap(rows)
  return new Map(
    rows.map((p) => [p.id, { ...p, teamName: p.teamId != null ? (teamsById.get(p.teamId) ?? null) : null }]),
  )
}

// ------------------------------------------------------------------ timesheet

/** How Sunday/holiday supplements are paid: the percentage is listed for payroll unless credited as time. */
function payrollConfig() {
  const st = getAllSettings()
  return { mode: st.holiday_work_surcharge_mode, percent: st.holiday_work_surcharge_percent }
}

export function timesheet(actor: Actor, raw: z.input<typeof timesheetInput>) {
  const input = timesheetInput.parse(raw)
  const user = input.userId != null && input.userId !== actor.id ? requireView(actor, input.userId) : actor.user
  const { year, month } = input
  const [start, end] = monthBounds(year, month)
  const tz = user.timezone
  const days = computeDays(user, start, end)
  const today = localToday(tz)
  const balanceBefore = timeBalance(user, addDays(start, -1)).balanceMin
  // complete days only, like the summary: today is still in progress
  const balanceAfter = start < today ? timeBalance(user, minDay(end, addDays(today, -1))).balanceMin : balanceBefore
  const vac = vacationAccount(user, year)
  const [startUtc, endUtc] = rangeBoundsUtc(start, end, tz)
  const entries = entriesBetween(user.id, startUtc, endUtc)
  const edited = editedEntryIds(entries.map((e) => e.id))
  const perDay: Record<string, { kind: string; start: string; end: string | null; edited: boolean; note: string }[]> =
    {}
  for (const e of entries) {
    pushTo(perDay, localDate(e.startAt, tz), {
      kind: e.kind,
      start: localTime(e.startAt, tz),
      end: e.endAt ? localTime(e.endAt, tz) : null,
      edited: edited.has(e.id) || e.source === "manual",
      note: e.note,
    })
  }
  const logs = logsBetween(user.id, start, end)
  const projectsById = projectMap(logs)
  const worklog: Record<
    string,
    {
      project: string | null
      customerRef: string
      note: string
      minutes: number
      start: string | null
      end: string | null
    }[]
  > = {}
  for (const w of logs) {
    pushTo(worklog, w.date, {
      project: w.projectId != null ? (projectsById.get(w.projectId)?.name ?? null) : null,
      customerRef: w.customerRef,
      note: w.note,
      minutes: w.minutes,
      start: w.startTime,
      end: w.endTime,
    })
  }
  const signoff = db
    .select()
    .from(monthSignoffs)
    .where(and(eq(monthSignoffs.userId, user.id), eq(monthSignoffs.month, `${year}-${String(month).padStart(2, "0")}`)))
    .all()
    .find((r) => r.reopenedAt == null)
  const team =
    user.teamId != null ? db.select({ name: teams.name }).from(teams).where(eq(teams.id, user.teamId)).get() : null
  return {
    report: "timesheet" as const,
    user: { id: user.id, name: user.name, email: user.email, team: team?.name ?? null, timezone: tz },
    year,
    month,
    days,
    entries: perDay,
    worklog,
    worklogMode: worklogConfig().mode,
    summary: summarize(days),
    payroll: payrollConfig(),
    balanceBeforeMin: balanceBefore,
    balanceAfterMin: balanceAfter,
    vacation: {
      entitlement: vac.entitlement,
      carriedOver: vac.carriedOver,
      taken: vac.taken,
      planned: vac.planned,
      remaining: vac.remaining,
    },
    company: getSetting("company_name"),
    signoff: signoff
      ? {
          signedBy:
            signoff.signedById != null ? (userNames([signoff.signedById]).get(signoff.signedById) ?? null) : null,
          signedAt: iso(signoff.signedAt),
          seal: signoff.seal.slice(0, 16),
        }
      : null,
  }
}
export type TimesheetData = ReturnType<typeof timesheet>

// ------------------------------------------------------------------ balances

export function balances(actor: Actor, raw: z.input<typeof balancesInput>) {
  const input = balancesInput.parse(raw)
  const { year } = input
  const month = input.month ?? null
  const [start, end] = month ? monthBounds(year, month) : [`${year}-01-01`, `${year}-12-31`]
  const people = scopeUsers(actor, { teamId: input.teamId, periodStart: start })
  const teamNames = teamNameMap(people)
  const rows = people.map((u) => {
    const s = summarize(computeDays(u, start, end))
    const vac = vacationAccount(u, year)
    return {
      userId: u.id,
      name: u.name,
      team: u.teamId != null ? (teamNames.get(u.teamId) ?? null) : null,
      targetMin: s.targetMin,
      workedMin: s.workedCompleteMin,
      deltaMin: s.deltaMin,
      sundayMin: s.sundayWorkMin,
      holidayMin: s.holidayWorkMin,
      nightMin: s.nightWorkMin,
      creditMin: round(s.surchargeMin + s.nightCreditMin),
      balanceMin: timeBalance(u).balanceMin,
      vacationTaken: vac.taken,
      vacationPlanned: vac.planned,
      vacationRemaining: vac.remaining,
      vacationPending: vac.pending,
    }
  })
  const total = (
    k: "targetMin" | "workedMin" | "deltaMin" | "balanceMin" | "sundayMin" | "holidayMin" | "nightMin" | "creditMin",
  ) => round(rows.reduce((acc, r) => acc + r[k], 0))
  return {
    report: "balances" as const,
    year,
    month,
    rows,
    totals: {
      targetMin: total("targetMin"),
      workedMin: total("workedMin"),
      deltaMin: total("deltaMin"),
      balanceMin: total("balanceMin"),
      sundayMin: total("sundayMin"),
      holidayMin: total("holidayMin"),
      nightMin: total("nightMin"),
      creditMin: total("creditMin"),
    },
    payroll: payrollConfig(),
    company: getSetting("company_name"),
  }
}
export type BalancesData = ReturnType<typeof balances>

// ------------------------------------------------------------------ absences

export function absencesReport(actor: Actor, raw: z.input<typeof rangeInput>) {
  const input = rangeInput.parse(raw)
  checkRange(input.from, input.to)
  const people = scopeUsers(actor, { teamId: input.teamId, userId: input.userId, periodStart: input.from })
  const byId = new Map(people.map((u) => [u.id, u]))
  const types = absenceTypesById()
  const items = absencesInRange([...byId.keys()], input.from, input.to, ["approved", "pending"])
  const byUser = new Map<number, Record<string, number>>(people.map((u) => [u.id, {}]))
  const rows = items.map((a) => {
    const u = byId.get(a.userId)!
    const t = types.get(a.typeId)!
    const days = clippedDays(u, a, input.from, input.to)
    if (a.status === "approved") {
      const bucket = byUser.get(u.id)!
      bucket[t.key] = round((bucket[t.key] ?? 0) + days)
    }
    return {
      id: a.id,
      userId: u.id,
      name: u.name,
      type: t.label,
      typeKey: t.key,
      color: t.color,
      status: a.status,
      startDate: a.startDate,
      endDate: a.endDate,
      startHalf: a.startHalf,
      endHalf: a.endHalf,
      days,
      note: a.note,
    }
  })
  const usedKeys = new Set(rows.map((r) => r.typeKey))
  return {
    report: "absences" as const,
    start: input.from,
    end: input.to,
    rows,
    summary: people.map((u) => {
      const byType = byUser.get(u.id)!
      return { userId: u.id, name: u.name, byType, total: round(Object.values(byType).reduce((a, b) => a + b, 0)) }
    }),
    types: [...types.values()]
      .filter((t) => usedKeys.has(t.key))
      .map((t) => ({ key: t.key, label: t.label, color: t.color })),
    company: getSetting("company_name"),
  }
}
export type AbsencesReportData = ReturnType<typeof absencesReport>

// ------------------------------------------------------------------ project hours

interface ProjectRow {
  projectId: number | null
  customerRef: string
  kind: "project" | "customer" | "none"
  name: string | null
  code: string
  color: string
  team: string | null
  minutes: number
  items: number
  people: { userId: number; name: string; minutes: number }[]
}

/** Logged minutes per project (or customer reference) and person, deleted items excluded. */
export function projectHours(actor: Actor, raw: z.input<typeof rangeInput>) {
  const input = rangeInput.parse(raw)
  checkRange(input.from, input.to)
  const people = scopeUsers(actor, { teamId: input.teamId, userId: input.userId, periodStart: input.from })
  const logs = people.flatMap((u) => logsBetween(u.id, input.from, input.to))
  const projectsById = projectMap(logs)
  const byProject = new Map<string, { row: ProjectRow; perPerson: Map<number, number> }>()
  const byPerson = new Map(
    people.map((u) => [
      u.id,
      {
        userId: u.id,
        name: u.name,
        team: null as string | null,
        minutes: 0,
        items: 0,
        byProject: emptyCounts(),
      },
    ]),
  )
  const teamNames = teamNameMap(people)
  for (const u of people) byPerson.get(u.id)!.team = u.teamId != null ? (teamNames.get(u.teamId) ?? null) : null
  for (const w of logs) {
    const p = w.projectId != null ? projectsById.get(w.projectId) : undefined
    const key = w.customerRef ? `c:${w.customerRef}` : `p:${w.projectId ?? ""}`
    let entry = byProject.get(key)
    if (!entry) {
      entry = {
        row: {
          projectId: w.projectId,
          customerRef: w.customerRef,
          kind: w.customerRef ? "customer" : p ? "project" : "none",
          name: w.customerRef || p?.name || null,
          code: p?.code ?? "",
          color: p?.color ?? "",
          team: p?.teamName ?? null,
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
    const person = byPerson.get(w.userId)!
    person.minutes += w.minutes
    person.items++
    const label = w.customerRef || p?.name || ""
    person.byProject[label] = (person.byProject[label] ?? 0) + w.minutes
  }
  for (const { row, perPerson } of byProject.values())
    row.people = [...perPerson.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([userId, minutes]) => ({ userId, name: byPerson.get(userId)!.name, minutes }))
  const projectRows = [...byProject.values()]
    .map((e) => e.row)
    .sort((a, b) => b.minutes - a.minutes || (a.name ?? "~").localeCompare(b.name ?? "~"))
  return {
    report: "projects" as const,
    start: input.from,
    end: input.to,
    projects: projectRows,
    people: [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)),
    totalMin: projectRows.reduce((acc, p) => acc + p.minutes, 0),
    company: getSetting("company_name"),
  }
}
export type ProjectHoursData = ReturnType<typeof projectHours>

// ------------------------------------------------------------------ raw export

/** Every time entry in the period incl. deleted and edited ones (leads for their teams, HR for all). */
export function rawEntries(actor: Actor, raw: z.input<typeof rangeInput>) {
  if (!isManager(actor)) throw new Forbidden("Only team leads and HR can export raw data")
  const input = rangeInput.parse(raw)
  checkRange(input.from, input.to)
  const people = scopeUsers(actor, { teamId: input.teamId, userId: input.userId, periodStart: input.from })
  return people.flatMap((u) => {
    const tz = u.timezone
    const [startUtc] = dayBoundsUtc(input.from, tz)
    const [, endUtc] = dayBoundsUtc(input.to, tz)
    const entries = entriesBetween(u.id, startUtc, endUtc, true)
    const edited = editedEntryIds(entries.map((e) => e.id))
    const local = (at: string) => `${localDate(at, tz)} ${localTime(at, tz)}`
    return entries.map((e) => ({
      entryId: e.id,
      userId: u.id,
      name: u.name,
      email: u.email,
      kind: e.kind,
      date: localDate(e.startAt, tz),
      startLocal: local(e.startAt),
      endLocal: e.endAt ? local(e.endAt) : "",
      startUtc: iso(e.startAt),
      endUtc: iso(e.endAt) ?? "",
      minutes: round((Date.parse(e.endAt ?? e.startAt) - Date.parse(e.startAt)) / 60000, 1),
      timezone: tz,
      source: e.source,
      edited: edited.has(e.id),
      deleted: e.isDeleted,
      note: e.note,
    }))
  })
}
export type RawEntryRow = ReturnType<typeof rawEntries>[number]
