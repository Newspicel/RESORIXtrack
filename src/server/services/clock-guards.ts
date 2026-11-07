/**
 * Legal minimums enforced at clock-in (setting `break_enforcement`; ArG Art. 15 and 15a). The same figures the
 * compliance engine reports as findings, applied before a new entry starts:
 *
 * - Minimum break for the time worked so far today: 15 min above 5.5 h, 30 min above 7 h, 60 min above 9 h
 *   (`breakRequiredMin`). 15 and 30 min must be taken in one piece (the longest gap between today's work
 *   entries counts, the gap running since the last clock-out included); 60 min may be split into pieces of at
 *   least 15 min.
 * - Daily rest of 11 h after the previous working day. Gaps under 3 h continue the same working day, and a
 *   gap within the same local day is a break, exactly as the compliance engine groups entries.
 *
 * Only clock-ins are blocked; a manual entry afterwards stays possible and gets the usual finding.
 */
import { and, desc, eq, isNotNull, lt } from "drizzle-orm"
import { db } from "../db"
import { timeEntries, type User } from "../db/schema"
import { Conflict } from "../errors"
import { dayBoundsUtc, iso, localDateOf } from "../time"
import { breakRequiredMin } from "./accounts"
import { active, rulesFrom } from "./compliance"
import { entriesBetween, instantOfMs, ms } from "./entries"
import { getAllSettings } from "./settings"

export const MIN_REST_MIN = 11 * 60
const SAME_DAY_GAP_MS = 3 * 3600_000
const SPLIT_PIECE_MIN = 15

const r2 = (n: number) => Math.round(n * 100) / 100

/** Refuses a clock-in at `t` (epoch ms) while the legal minimum break or daily rest is not yet complete. */
export function ensureLegalRest(user: User, t: number): void {
  const st = getAllSettings()
  if (!st.break_enforcement || !active(rulesFrom(st), user) || user.recordingMode !== "full") return
  ensureBreakTaken(user, t)
  ensureDailyRest(user, t)
}

function ensureBreakTaken(user: User, t: number): void {
  const at = instantOfMs(t)
  const [dayStart] = dayBoundsUtc(localDateOf(at, user.timezone), user.timezone)
  const segments: { a: number; b: number }[] = []
  let workedMs = 0
  for (const e of entriesBetween(user.id, dayStart, at)) {
    if (e.kind !== "work" || !e.endAt) continue
    const a = Math.max(ms(e.startAt), ms(dayStart))
    const b = Math.min(ms(e.endAt), t)
    if (b <= a) continue
    workedMs += b - a
    segments.push({ a, b })
  }
  const required = breakRequiredMin(workedMs / 60000)
  if (!required) return
  segments.sort((x, y) => x.a - y.a)
  const gaps: number[] = []
  let lastEnd = segments[0].b
  for (const s of segments.slice(1)) {
    gaps.push(Math.max(0, (s.a - lastEnd) / 60000))
    lastEnd = Math.max(lastEnd, s.b)
  }
  const running = (t - lastEnd) / 60000
  let taken: number
  let earliest: number
  if (required < 60) {
    taken = Math.max(running, ...gaps)
    earliest = lastEnd + required * 60000
  } else {
    const other = gaps.filter((g) => g >= SPLIT_PIECE_MIN).reduce((sum, g) => sum + g, 0)
    taken = other + (running >= SPLIT_PIECE_MIN ? running : 0)
    earliest = lastEnd + Math.max(required - other, SPLIT_PIECE_MIN) * 60000
  }
  if (taken + 1e-9 >= required) return
  throw new Conflict(`The legal minimum break of ${required} min has not been taken yet`, {
    code: "break_required",
    fields: { required, taken: r2(taken), earliest: iso(instantOfMs(earliest)) },
  })
}

function ensureDailyRest(user: User, t: number): void {
  const at = instantOfMs(t)
  // entries never overlap, so the latest start before `t` is also the latest end (index on user_id, start_at)
  const prev = db
    .select({ startAt: timeEntries.startAt, endAt: timeEntries.endAt })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, user.id),
        eq(timeEntries.isDeleted, false),
        isNotNull(timeEntries.endAt),
        lt(timeEntries.startAt, at),
      ),
    )
    .orderBy(desc(timeEntries.startAt))
    .limit(1)
    .get()
  if (!prev?.endAt) return
  const gap = t - ms(prev.endAt)
  if (gap >= MIN_REST_MIN * 60000 || gap < SAME_DAY_GAP_MS) return
  if (localDateOf(prev.startAt, user.timezone) === localDateOf(at, user.timezone)) return
  throw new Conflict("The daily rest of 11 hours is not complete yet", {
    code: "rest_required",
    fields: { requiredMin: MIN_REST_MIN, earliest: iso(instantOfMs(ms(prev.endAt) + MIN_REST_MIN * 60000)) },
  })
}
