/**
 * Swiss labour law checks (docs/compliance.md). The rule engine (`evaluatePeriod`, `dayFindings`,
 * `overtimeFromDays`) is pure: figures in, findings out. The loaders (`periodFindings`, `overtimeYear`,
 * `yearFindings`, `teamComplianceSummary`) fetch the same day figures the accounts use.
 *
 * Findings never block recording. No checks run when the company is not subject to the ArG
 * (`compliance_enabled` off), for senior executives (`users.argExempt`, ArG Art. 3 lit. d) and for
 * `users.recordingMode = waived`; `simplified` (daily totals only) skips the rules that need start and end
 * times (breaks, daily rest, day span).
 *
 * Working days for rest and span: work and break entries are merged into blocks (gaps under 3 h are
 * breaks); a block belongs to the local day it starts on, so a night shift stays one working day.
 */
import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "../db"
import { type User, users } from "../db/schema"
import { addDays, localToday, weekStart, zone } from "../time"
import {
  breakRequiredMin,
  computeDaysFrom,
  type Day,
  dayStartsMs,
  employmentFraction,
  entitlementForYear,
  entitlementOverrides,
  loadContext,
  workdaysFactor,
} from "./accounts"
import { type Actor, isManager, requireView, visibleUserIds } from "./permissions"
import { getAllSettings, type Settings } from "./settings"

export const RULES = {
  break_min: "ArG Art. 15",
  daily_rest: "ArG Art. 15a",
  day_span: "ArG Art. 10 para. 3",
  night_work: "ArG Art. 16/17",
  sunday_work: "ArG Art. 18, 20a",
  compensatory_rest: "ArG Art. 20",
  weekly_max: "ArG Art. 9",
  overtime_daily: "ArG Art. 12 para. 2",
  overtime_yearly: "ArG Art. 12 para. 2",
  consecutive_days: "ArG Art. 18-21",
  vacation_minimum: "OR 329a",
  vacation_block: "OR 329c",
} as const
export type RuleKey = keyof typeof RULES
export type Severity = "violation" | "warning" | "info"

export interface Finding {
  rule: RuleKey
  severity: Severity
  date?: string
  /** Monday of the ISO week */
  week?: string
  year?: number
  value: number
  limit: number
  ref: string
}

export interface ComplianceRules {
  enabled: boolean
  nightPermitted: boolean
  sundayPermitted: boolean
}

export interface CompliancePerson {
  recordingMode: User["recordingMode"]
  legalWeeklyMaxHours: number
  argExempt: boolean
}

export type DayFigures = Pick<
  Day,
  "date" | "weekday" | "workedMin" | "breakMin" | "isWorkday" | "isFuture" | "running"
> &
  Partial<Pick<Day, "holiday" | "absences">>

export interface EntryInterval {
  kind: "work" | "break"
  startMs: number
  endMs: number
}

const H = 3600_000
const MIN_REST_MS = 11 * H
const SHORT_REST_MS = 8 * H
const MAX_SPAN_MIN = 14 * 60
const BLOCK_GAP_MS = 3 * H
const MAX_CONSECUTIVE = 6
const DAILY_OVERTIME_MAX = 120
const COMP_REST_THRESHOLD = 300 // > 5 h of Sunday/holiday work needs a 24 h rest day (ArG Art. 20 para. 2)
const finding = (rule: RuleKey, severity: Severity, value: number, limit: number, at: Partial<Finding>): Finding => ({
  rule,
  severity,
  ...at,
  value: Math.round(value * 100) / 100,
  limit,
  ref: RULES[rule],
})

export function rulesFrom(st: Settings): ComplianceRules {
  return {
    enabled: st.compliance_enabled,
    nightPermitted: st.night_work_permitted,
    sundayPermitted: st.sunday_work_permitted,
  }
}

/** The ArG applies to the company and the person, and the person records times (Art. 2, 3 lit. d; ArGV 1 Art. 73a). */
export const active = (rules: ComplianceRules, person: CompliancePerson) =>
  rules.enabled && !person.argExempt && person.recordingMode !== "waived"
const timesKnown = (person: CompliancePerson) => person.recordingMode === "full"

/** Day-local findings (breaks) for one completed day. */
export function dayFindings(day: DayFigures, rules: ComplianceRules, person: CompliancePerson): Finding[] {
  if (!active(rules, person) || !timesKnown(person)) return []
  if (day.isFuture || day.running || day.workedMin <= 0) return []
  const required = breakRequiredMin(day.workedMin)
  if (day.breakMin + 1e-9 < required)
    return [finding("break_min", "violation", day.breakMin, required, { date: day.date })]
  return []
}

/** Überzeit per day: worked minutes beyond the legal weekly maximum, attributed cumulatively within each week. */
export function overtimeFromDays(days: DayFigures[], weeklyMaxHours: number): Map<string, number> {
  const out = new Map<string, number>()
  const max = weeklyMaxHours * 60
  let week = ""
  let cumulative = 0
  for (const d of days) {
    const w = addDays(d.date, -d.weekday)
    if (w !== week) {
      week = w
      cumulative = 0
    }
    const before = cumulative
    cumulative += d.workedMin
    const over = Math.max(0, cumulative - Math.max(max, before))
    if (over > 0) out.set(d.date, over)
  }
  return out
}

interface Block {
  day: string
  startMs: number
  endMs: number
}

function workingBlocks(entries: EntryInterval[], tz: string): Block[] {
  const sorted = [...entries].filter((e) => e.endMs > e.startMs).sort((a, b) => a.startMs - b.startMs)
  const blocks: Block[] = []
  let cur: { startMs: number; endMs: number; hasWork: boolean } | null = null
  const flush = () => {
    if (cur?.hasWork) {
      const day = Temporal.Instant.fromEpochMilliseconds(cur.startMs).toZonedDateTimeISO(tz).toPlainDate().toString()
      blocks.push({ day, startMs: cur.startMs, endMs: cur.endMs })
    }
  }
  for (const e of sorted) {
    if (cur && e.startMs - cur.endMs < BLOCK_GAP_MS) {
      cur.endMs = Math.max(cur.endMs, e.endMs)
      cur.hasWork ||= e.kind === "work"
    } else {
      flush()
      cur = { startMs: e.startMs, endMs: e.endMs, hasWork: e.kind === "work" }
    }
  }
  flush()
  return blocks
}

function localMs(date: string, hour: number, tz: string): number {
  return Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: tz, plainTime: { hour, minute: 0 } })
    .epochMilliseconds
}

function overlapMin(work: EntryInterval[], a: number, b: number): number {
  let total = 0
  for (const e of work) {
    if (e.endMs <= a || e.startMs >= b) continue
    total += Math.min(e.endMs, b) - Math.max(e.startMs, a)
  }
  return total / 60000
}

export interface PeriodInput {
  /** Findings are reported for [start, end]; `days` and `entries` may reach further back (weeks, rest). */
  start: string
  end: string
  tz: string
  days: DayFigures[]
  entries: EntryInterval[]
  person: CompliancePerson
  rules: ComplianceRules
}

/** All day- and week-level findings of a period (pure). */
export function evaluatePeriod(input: PeriodInput): Finding[] {
  const { person, rules, start, end } = input
  if (!active(rules, person)) return []
  const tz = zone(input.tz)
  const inRange = (d: string) => d >= start && d <= end
  const out: Finding[] = []
  const days = [...input.days].sort((a, b) => (a.date < b.date ? -1 : 1))
  const work = input.entries.filter((e) => e.kind === "work" && e.endMs > e.startMs)

  for (const d of days) if (inRange(d.date)) out.push(...dayFindings(d, rules, person))

  // daily rest, day span, consecutive working days (blocks by working day)
  const blocks = workingBlocks(input.entries, tz)
  const byDay = new Map<string, { startMs: number; endMs: number }>()
  for (const b of blocks) {
    const cur = byDay.get(b.day)
    if (cur) {
      cur.startMs = Math.min(cur.startMs, b.startMs)
      cur.endMs = Math.max(cur.endMs, b.endMs)
    } else byDay.set(b.day, { startMs: b.startMs, endMs: b.endMs })
  }
  const workDays = [...byDay.keys()].sort()
  if (timesKnown(person)) {
    const reducedWeeks = new Set<string>()
    for (let i = 0; i < workDays.length; i++) {
      const day = workDays[i]
      const cur = byDay.get(day)!
      const span = (cur.endMs - cur.startMs) / 60000
      if (span > MAX_SPAN_MIN && inRange(day))
        out.push(finding("day_span", "violation", span, MAX_SPAN_MIN, { date: day }))
      if (i === 0) continue
      const prev = byDay.get(workDays[i - 1])!
      const rest = cur.startMs - prev.endMs
      if (rest >= MIN_REST_MS) continue
      const week = weekStart(day)
      let severity: Severity = "violation"
      // once a week the rest may be reduced to 8 h (ArG Art. 15a para. 2)
      if (rest >= SHORT_REST_MS && !reducedWeeks.has(week)) severity = "warning"
      if (rest >= SHORT_REST_MS) reducedWeeks.add(week)
      if (inRange(day)) out.push(finding("daily_rest", severity, rest / 60000, MIN_REST_MS / 60000, { date: day }))
    }
  }
  let run = 0
  let prevDay = ""
  for (const day of workDays) {
    run = prevDay && addDays(prevDay, 1) === day ? run + 1 : 1
    prevDay = day
    if (run === MAX_CONSECUTIVE + 1 && inRange(day)) {
      out.push(finding("consecutive_days", "violation", run, MAX_CONSECUTIVE, { date: day }))
    }
  }

  // night and Sunday work (public holidays equal Sundays, ArG Art. 20a)
  const nightSeverity: Severity = rules.nightPermitted ? "info" : "warning"
  const sundaySeverity: Severity = rules.sundayPermitted ? "info" : "warning"
  const byDate = new Map(days.map((d) => [d.date, d]))
  for (const d of days) {
    if (!inRange(d.date) || d.workedMin <= 0) continue
    const [dayStart, nextStart] = dayStartsMs(d.date, 2, tz)
    const night =
      overlapMin(work, dayStart, localMs(d.date, 6, tz)) + overlapMin(work, localMs(d.date, 23, tz), nextStart)
    if (night > 0) out.push(finding("night_work", nightSeverity, night, 0, { date: d.date }))
    if (sundayLike(d)) {
      const sunday = overlapMin(work, localMs(addDays(d.date, -1), 23, tz), localMs(d.date, 23, tz))
      if (sunday > 0) {
        out.push(finding("sunday_work", sundaySeverity, sunday, 0, { date: d.date }))
        const rest = compensatoryRest(d.date, sunday, byDate)
        if (rest) out.push(rest)
      }
    }
  }

  // weekly maximum and daily Überzeit
  const max = person.legalWeeklyMaxHours * 60
  const weeks = new Map<string, number>()
  for (const d of days) {
    const w = addDays(d.date, -d.weekday)
    weeks.set(w, (weeks.get(w) ?? 0) + d.workedMin)
  }
  for (const [w, worked] of weeks) {
    if (worked > max && w <= end && addDays(w, 6) >= start)
      out.push(finding("weekly_max", "warning", worked, max, { week: w }))
  }
  const overtime = overtimeFromDays(days, person.legalWeeklyMaxHours)
  for (const d of days) {
    const over = overtime.get(d.date) ?? 0
    // allowed beyond 2 h on work-free weekdays (ArG Art. 12 para. 2)
    if (over > DAILY_OVERTIME_MAX && inRange(d.date) && (d.isWorkday || d.weekday === 6)) {
      out.push(finding("overtime_daily", "violation", over, DAILY_OVERTIME_MAX, { date: d.date }))
    }
  }
  return out.sort(
    (a, b) => (a.date ?? a.week ?? "").localeCompare(b.date ?? b.week ?? "") || a.rule.localeCompare(b.rule),
  )
}

/** Sunday, 1 August or a full-day public holiday of the person's calendar (ArG Art. 18, 20a). */
function sundayLike(d: DayFigures): boolean {
  return d.weekday === 6 || d.date.slice(5) === "08-01" || (d.holiday?.fraction ?? 0) >= 1
}

/** A day that can be the compensatory rest day: a scheduled working day (Mon to Sat) without work or leave. */
function restDay(d: DayFigures): boolean {
  if (d.isFuture || sundayLike(d) || !d.isWorkday || d.workedMin > 0 || d.running) return false
  return (d.absences ?? []).every((a) => a.status !== "approved" || a.typeKey === "comp_time")
}

/**
 * ArG Art. 20: up to 5 h of Sunday/holiday work are compensated with equal time off within 4 weeks (info);
 * more needs a rest day of 24 consecutive hours on a working day in the week before or after. Missing once
 * that window has passed: violation; while it is still open: info.
 */
function compensatoryRest(date: string, minutes: number, byDate: Map<string, DayFigures>): Finding | null {
  if (minutes <= COMP_REST_THRESHOLD)
    return finding("compensatory_rest", "info", minutes, COMP_REST_THRESHOLD, { date })
  let open = false
  for (let i = -7; i <= 7; i++) {
    if (i === 0) continue
    const d = byDate.get(addDays(date, i))
    if (!d || d.isFuture) {
      if (i > 0) open = true
      continue
    }
    if (restDay(d)) return null
  }
  return finding("compensatory_rest", open ? "info" : "violation", minutes, COMP_REST_THRESHOLD, { date })
}

// ------------------------------------------------------------------ loaders

function personOf(user: User): CompliancePerson {
  return {
    recordingMode: user.recordingMode,
    legalWeeklyMaxHours: user.legalWeeklyMaxHours,
    argExempt: user.argExempt,
  }
}

function load(user: User, from: string, to: string) {
  const ctx = loadContext(user, from, to, { includePending: false, projects: false })
  const nowMs = ctx.nowMs
  const entries: EntryInterval[] = ctx.entries.map((e) => ({
    kind: e.kind,
    startMs: Date.parse(e.startAt),
    endMs: e.endAt ? Date.parse(e.endAt) : nowMs,
  }))
  return { ctx, days: computeDaysFrom(ctx, { raw: true }), entries }
}

/** Findings for a person in [start, end] (dates in the person's timezone). */
export function periodFindings(user: User, start: string, end: string): Finding[] {
  const st = getAllSettings()
  const rules = rulesFrom(st)
  const person = personOf(user)
  if (!active(rules, person) || end < start) return []
  const from = weekStart(addDays(start, -7))
  // a week beyond the end: the compensatory rest day may follow Sunday work (ArG Art. 20)
  const to = addDays(weekStart(addDays(end, 7)), 6)
  const { days, entries } = load(user, from, to)
  return evaluatePeriod({ start, end, tz: user.timezone, days, entries, person, rules })
}

export interface OvertimeYear {
  userId: number
  year: number
  weeklyMaxHours: number
  overtimeMin: number
  limitMin: number
  warnAtMin: number
  weeks: { week: string; workedMin: number; overtimeMin: number }[]
}

/** Überzeit tally of a calendar year vs 170 h (45-h staff) / 140 h (50-h staff). */
export function overtimeYear(user: User, year: number): OvertimeYear {
  const yStart = `${year}-01-01`
  const yEnd = `${year}-12-31`
  const today = localToday(user.timezone)
  const to = yEnd < today ? addDays(weekStart(yEnd), 6) : today
  const { days } = load(user, weekStart(yStart), to)
  const perDay = overtimeFromDays(days, user.legalWeeklyMaxHours)
  const weeks = new Map<string, { workedMin: number; overtimeMin: number }>()
  let total = 0
  for (const d of days) {
    if (d.date < yStart || d.date > yEnd) continue
    const over = perDay.get(d.date) ?? 0
    total += over
    const w = addDays(d.date, -d.weekday)
    const cur = weeks.get(w) ?? { workedMin: 0, overtimeMin: 0 }
    cur.workedMin += d.workedMin
    cur.overtimeMin += over
    weeks.set(w, cur)
  }
  const limit = (user.legalWeeklyMaxHours >= 50 ? 140 : 170) * 60
  return {
    userId: user.id,
    year,
    weeklyMaxHours: user.legalWeeklyMaxHours,
    overtimeMin: Math.round(total * 100) / 100,
    limitMin: limit,
    warnAtMin: limit * 0.8,
    weeks: [...weeks.entries()]
      .filter(([, v]) => v.overtimeMin > 0)
      .map(([week, v]) => ({
        week,
        workedMin: Math.round(v.workedMin * 100) / 100,
        overtimeMin: Math.round(v.overtimeMin * 100) / 100,
      })),
  }
}

/** Pure check of a yearly Überzeit tally. */
export function overtimeYearFinding(
  o: Pick<OvertimeYear, "year" | "overtimeMin" | "limitMin" | "warnAtMin">,
): Finding | null {
  if (o.overtimeMin > o.limitMin)
    return finding("overtime_yearly", "violation", o.overtimeMin, o.limitMin, { year: o.year })
  if (o.overtimeMin >= o.warnAtMin)
    return finding("overtime_yearly", "warning", o.overtimeMin, o.limitMin, { year: o.year })
  return null
}

/** OR 329a: 4 weeks (5 weeks up to and including the year the person turns 20), in scheduled days. */
export function minimumVacationDays(
  daysPerWeek: number,
  employedFraction: number,
  year: number,
  birthDate: string | null,
): number {
  const young = birthDate != null && year <= Number(birthDate.slice(0, 4)) + 20
  return (young ? 5 : 4) * daysPerWeek * employedFraction
}

/** OR 329c: is there a block of >= 2 weeks off (vacation plus free days, at least one vacation day)? */
export function hasVacationBlock(days: Pick<Day, "date" | "scheduledMin" | "vacationDays" | "holiday">[]): boolean {
  let run = 0
  let withVacation = false
  for (const d of days) {
    const vacation = d.vacationDays >= 1
    const free = d.scheduledMin <= 0 || (d.holiday?.fraction ?? 0) >= 1
    if (vacation || free) {
      run++
      withVacation ||= vacation
      if (run >= 14 && withVacation) return true
    } else {
      run = 0
      withVacation = false
    }
  }
  return false
}

/** Year-level findings: Überzeit tally, minimum vacation entitlement, two-week vacation block. */
export function yearFindings(user: User, year: number): Finding[] {
  const st = getAllSettings()
  const rules = rulesFrom(st)
  const person = personOf(user)
  if (!active(rules, person)) return []
  const out: Finding[] = []
  const ot = overtimeYearFinding(overtimeYear(user, year))
  if (ot) out.push(ot)
  const frac = employmentFraction(user, year)
  if (frac <= 0) return out
  const ctx = loadContext(user, `${year}-01-01`, `${year}-12-31`, {
    includePending: false,
    entries: false,
    projects: false,
  })
  const s = user.employmentStart && user.employmentStart > `${year}-01-01` ? user.employmentStart : `${year}-01-01`
  const e = user.employmentEnd && user.employmentEnd < `${year}-12-31` ? user.employmentEnd : `${year}-12-31`
  const daysPerWeek = workdaysFactor(ctx.schedules, s, e) * 5
  const entitlement = entitlementForYear(
    user,
    year,
    entitlementOverrides(user.id),
    ctx.schedules,
    st.vacation_prorate_workdays,
  )
  const minimum = Math.floor(minimumVacationDays(daysPerWeek, frac, year, user.birthDate) * 2) / 2
  if (entitlement + 1e-9 < minimum) out.push(finding("vacation_minimum", "violation", entitlement, minimum, { year }))
  if (localToday(user.timezone) >= `${year}-10-01` && frac >= 0.5 && entitlement >= 2 * daysPerWeek) {
    if (!hasVacationBlock(computeDaysFrom(ctx, { raw: true })))
      out.push(finding("vacation_block", "info", 0, 14, { year }))
  }
  return out
}

// ------------------------------------------------------------------ access-checked views

export interface FindingCounts {
  violation: number
  warning: number
  info: number
}

export function countFindings(findings: Finding[]): FindingCounts {
  const c: FindingCounts = { violation: 0, warning: 0, info: 0 }
  for (const f of findings) c[f.severity]++
  return c
}

export function findingsFor(actor: Actor, userId: number, start: string, end: string) {
  const user = requireView(actor, userId)
  const findings = periodFindings(user, start, end)
  return { userId: user.id, start, end, findings, counts: countFindings(findings) }
}

export function yearFindingsFor(actor: Actor, userId: number, year: number) {
  const user = requireView(actor, userId)
  const overtime = overtimeYear(user, year)
  return { overtime, findings: yearFindings(user, year) }
}

export interface TeamComplianceRow {
  userId: number
  name: string
  teamId: number | null
  counts: FindingCounts
  rules: Partial<Record<RuleKey, number>>
}

/** Finding counts per visible person (managers: own teams; HR: everyone), optionally one team. */
export function teamComplianceSummary(
  actor: Actor,
  start: string,
  end: string,
  teamId?: number | null,
): TeamComplianceRow[] {
  if (!isManager(actor)) return []
  const ids = visibleUserIds(actor)
  const conds = [eq(users.isActive, true)]
  if (ids)
    conds.push(
      inArray(
        users.id,
        ids.filter((id) => id !== actor.id),
      ),
    )
  if (teamId != null) conds.push(eq(users.teamId, teamId))
  const people = db
    .select()
    .from(users)
    .where(and(...conds))
    .orderBy(asc(users.name))
    .all()
  return people.map((u) => {
    const findings = periodFindings(u, start, end)
    const rules: Partial<Record<RuleKey, number>> = {}
    for (const f of findings) rules[f.rule] = (rules[f.rule] ?? 0) + 1
    return { userId: u.id, name: u.name, teamId: u.teamId, counts: countFindings(findings), rules }
  })
}
