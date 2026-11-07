/**
 * Projects live on the time entries now. Legacy work log rows (1.x data, or a 2.0 database from before the
 * change) of open days are merged into the day's work entries: an item with times labels the attendance it
 * covers, an item with a duration fills the day's remaining attendance from the morning on. An entry that
 * ends up with several projects is split at the boundaries; the attendance itself never changes. Merged rows
 * are soft-deleted. Entries carry no customer reference, so a legacy one joins the note. Every change is a revision (source `migration`). Days inside an active sign-off stay as
 * they are: their seals cover the rows, and reports and day coverage still read them.
 *
 * Runs after the migrations (every start, a no-op once merged), after `rt import-v1` and after a reopen.
 */
import type Database from "better-sqlite3"

export const LEGACY_WORKLOG_REASON = "The work log was merged into the time entries: projects live on the entries now"

interface LogRow {
  id: number
  user_id: number
  date: string
  project_id: number | null
  minutes: number
  start_time: string | null
  end_time: string | null
  customer_ref: string
  note: string
  timezone: string
}

interface EntryRow {
  id: number
  user_id: number
  kind: string
  start_at: string
  end_at: string
  scheduled_end_at: string | null
  tz: string
  note: string
  project_id: number | null
  source: string
  is_deleted: number
  created_by_id: number | null
  created_at: string
}

interface Label {
  projectId: number | null
  note: string
}

interface Piece {
  a: number
  b: number
  label: Label | null
}

const fmt = (ms: number) => new Date(ms).toISOString().replace("Z", "000Z")
const isoMs = (at: string) => Temporal.Instant.from(at).toString({ smallestUnit: "millisecond" })
const toMs = (at: string) => Temporal.Instant.from(at).epochMilliseconds
const wall = (date: string, hhmm: string, tz: string) =>
  Temporal.PlainDateTime.from(`${date}T${hhmm}`).toZonedDateTime(tz).epochMilliseconds
/** [start, end) of a local day in epoch ms. */
function dayRange(date: string, tz: string): [number, number] {
  const d = Temporal.PlainDate.from(date)
  return [
    d.toZonedDateTime({ timeZone: tz }).epochMilliseconds,
    d.add({ days: 1 }).toZonedDateTime({ timeZone: tz }).epochMilliseconds,
  ]
}

const joinNotes = (a: string, b: string) => [a, b].filter(Boolean).join(" · ").slice(0, 500)

type Part = Piece & { entryId: number }

/** Gives `label` to the unlabelled parts inside [a, b). */
function labelRange(parts: Part[], a: number, b: number, label: Label): Part[] {
  return parts.flatMap((p) => {
    if (p.label || p.b <= a || p.a >= b) return [p]
    const out: Part[] = []
    if (p.a < a) out.push({ ...p, b: a })
    out.push({ ...p, a: Math.max(p.a, a), b: Math.min(p.b, b), label })
    if (p.b > b) out.push({ ...p, a: b })
    return out
  })
}

/** Gives `label` to the first `ms` of unlabelled time, in order. */
function labelDuration(parts: Part[], ms: number, label: Label): Part[] {
  let left = ms
  return parts.flatMap((p) => {
    if (p.label || left <= 0) return [p]
    const take = Math.min(left, p.b - p.a)
    left -= take
    return take < p.b - p.a
      ? [
          { ...p, b: p.a + take, label },
          { ...p, a: p.a + take },
        ]
      : [{ ...p, label }]
  })
}

function sameLabel(x: Label | null, y: Label | null): boolean {
  return x === y || (x != null && y != null && x.projectId === y.projectId && x.note === y.note)
}

type LegacyItem = Pick<LogRow, "minutes" | "start_time" | "end_time" | "project_id" | "customer_ref" | "note">

/**
 * The pieces of each entry after labelling one day: items with times first, then durations in order. Parts of
 * an entry outside the day stay unlabelled; neighbours with the same label are joined. Pure.
 */
export function allocate(
  entries: { id: number; a: number; b: number }[],
  items: LegacyItem[],
  date: string,
  tz: string,
): Map<number, Piece[]> {
  const [d0, d1] = dayRange(date, tz)
  let parts: Part[] = entries
    .map((e) => ({ entryId: e.id, a: Math.max(e.a, d0), b: Math.min(e.b, d1), label: null }))
    .filter((p) => p.b > p.a)
    .sort((x, y) => x.a - y.a)
  const labelOf = (l: LegacyItem): Label => ({ projectId: l.project_id, note: joinNotes(l.customer_ref, l.note) })
  for (const l of items)
    if (l.start_time && l.end_time)
      parts = labelRange(parts, wall(date, l.start_time, tz), wall(date, l.end_time, tz), labelOf(l))
  for (const l of items) if (!l.start_time || !l.end_time) parts = labelDuration(parts, l.minutes * 60_000, labelOf(l))
  const out = new Map<number, Piece[]>()
  for (const e of entries) {
    const all: Piece[] = [
      ...(e.a < d0 ? [{ a: e.a, b: d0, label: null }] : []),
      ...parts.filter((p) => p.entryId === e.id).map(({ a, b, label }) => ({ a, b, label })),
      ...(e.b > d1 ? [{ a: d1, b: e.b, label: null }] : []),
    ]
    const joined: Piece[] = []
    for (const p of all) {
      const last = joined.at(-1)
      if (last && last.b === p.a && sameLabel(last.label, p.label)) last.b = p.b
      else joined.push({ ...p })
    }
    out.set(e.id, joined)
  }
  return out
}

const SIGNED_DAY = `EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = w.user_id AND s.reopened_at IS NULL
  AND w.date BETWEEN s.period_start_date AND s.period_end_date)`
const SIGNED_ENTRY = `EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = e.user_id AND s.reopened_at IS NULL
  AND e.start_at < s.period_end_utc AND e.end_at > s.period_start_utc)`

function entrySnapshot(e: EntryRow) {
  return {
    kind: e.kind,
    start_at: isoMs(e.start_at),
    end_at: isoMs(e.end_at),
    scheduled_end_at: e.scheduled_end_at ? isoMs(e.scheduled_end_at) : null,
    tz: e.tz,
    note: e.note,
    project_id: e.project_id,
    source: e.source,
    is_deleted: Boolean(e.is_deleted),
  }
}

function logSnapshot(l: LogRow, deleted: boolean) {
  return {
    date: l.date,
    project_id: l.project_id,
    customer_ref: l.customer_ref,
    minutes: l.minutes,
    start_time: l.start_time,
    end_time: l.end_time,
    note: l.note,
    is_deleted: deleted,
  }
}

/** Merges the open days' legacy rows (of one person, or everyone); returns the number of merged rows. */
export function mergeLegacyWorklogs(sqlite: Database.Database, userId?: number): number {
  const logs = sqlite
    .prepare<unknown[], LogRow>(
      `SELECT w.id, w.user_id, w.date, w.project_id, w.minutes, w.start_time, w.end_time, w.customer_ref, w.note,
              u.timezone
       FROM work_logs w JOIN users u ON u.id = w.user_id
       WHERE w.is_deleted = 0 ${userId != null ? "AND w.user_id = ?" : ""} AND NOT ${SIGNED_DAY}
       ORDER BY w.user_id, w.date, w.id`,
    )
    .all(...(userId != null ? [userId] : []))
  if (!logs.length) return 0
  const now = fmt(Date.now())
  const revision = sqlite.prepare(
    `INSERT INTO revisions (entity, entity_id, subject_user_id, actor_id, action, before, after, reason, source, at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'migration', ?)`,
  )
  const rev = (entity: string, id: number, user: number, action: string, before: unknown, after: unknown) =>
    revision.run(
      entity,
      id,
      user,
      action,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      LEGACY_WORKLOG_REASON,
      now,
    )
  const dayEntries = sqlite.prepare<[number, string, string], EntryRow & { signed: number }>(
    `SELECT e.*, ${SIGNED_ENTRY} AS signed FROM time_entries e
     WHERE e.user_id = ? AND e.is_deleted = 0 AND e.kind = 'work' AND e.end_at IS NOT NULL
       AND e.start_at < ? AND e.end_at > ? ORDER BY e.start_at`,
  )
  const updateEntry = sqlite.prepare(
    "UPDATE time_entries SET end_at = ?, note = ?, project_id = ?, updated_at = ? WHERE id = ?",
  )
  const insertEntry = sqlite.prepare<unknown[], EntryRow>(
    `INSERT INTO time_entries (user_id, kind, start_at, end_at, tz, note, project_id, source, is_deleted,
       created_by_id, created_at, updated_at)
     VALUES (?, 'work', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?) RETURNING *`,
  )
  const deleteLog = sqlite.prepare("UPDATE work_logs SET is_deleted = 1, updated_at = ? WHERE id = ?")

  let merged = 0
  const days = new Map<string, LogRow[]>()
  for (const l of logs) {
    const key = `${l.user_id}|${l.date}`
    days.set(key, [...(days.get(key) ?? []), l])
  }
  for (const group of days.values()) {
    const { user_id: user, date, timezone: tz } = group[0]
    const [d0, d1] = dayRange(date, tz)
    const rows = dayEntries.all(user, fmt(d1), fmt(d0))
    if (rows.some((r) => r.signed)) continue
    const open = rows.filter((r) => r.project_id == null)
    const pieces = allocate(
      open.map((r) => ({ id: r.id, a: toMs(r.start_at), b: toMs(r.end_at) })),
      group,
      date,
      tz,
    )
    for (const e of open) {
      const ps = pieces.get(e.id) ?? []
      if (!ps.some((p) => p.label)) continue
      const end = (p: Piece) => (p.b === toMs(e.end_at) ? e.end_at : fmt(p.b))
      const [first, ...rest] = ps
      const label = first.label
      const next: EntryRow = {
        ...e,
        end_at: end(first),
        note: label ? joinNotes(e.note, label.note) : e.note,
        project_id: label?.projectId ?? null,
      }
      updateEntry.run(next.end_at, next.note, next.project_id, now, e.id)
      rev("time_entry", e.id, user, "update", entrySnapshot(e), entrySnapshot(next))
      for (const p of rest) {
        const row = insertEntry.get(
          user,
          fmt(p.a),
          end(p),
          e.tz,
          p.label ? joinNotes(e.note, p.label.note) : e.note,
          p.label?.projectId ?? null,
          e.source,
          e.created_by_id,
          e.created_at,
          now,
        )!
        rev("time_entry", row.id, user, "create", null, entrySnapshot(row))
      }
    }
    for (const l of group) {
      deleteLog.run(now, l.id)
      rev("work_log", l.id, user, "delete", logSnapshot(l, false), logSnapshot(l, true))
      merged++
    }
  }
  return merged
}
