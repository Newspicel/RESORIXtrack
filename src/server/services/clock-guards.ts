/**
 * Legal minimums enforced at clock-in (setting `break_enforcement`; ArG Art. 15 and 15a). The same figures the
 * compliance engine reports as findings, applied before a new entry starts:
 *
 * - Minimum break for the time worked so far on this working day: 15 min above 5.5 h, 30 min above 7 h, 60 min above 9 h
 *   (`breakRequiredMin`). 15 and 30 min must be taken in one piece (the longest gap between the day's work
 *   entries counts, the gap running since the last clock-out included); 60 min may be split into pieces of at
 *   least 15 min.
 * - Daily rest of 11 h after the previous working day.
 *
 * Working days are grouped as in the compliance engine: gaps under 3 h continue a block, a block belongs to
 * the local day it starts, and later blocks of that day follow a break.
 *
 * Only clock-ins are blocked; a manual entry afterwards stays possible and gets the usual finding.
 */
import type { User } from "../db/schema"
import { Conflict } from "../errors"
import { iso, localDateOf } from "../time"
import { breakRequiredMin } from "./accounts"
import { active, rulesFrom } from "./compliance"
import { entriesBetween, instantOfMs, ms } from "./entries"
import { getAllSettings } from "./settings"

export const MIN_REST_MIN = 11 * 60
const BLOCK_GAP_MS = 3 * 3600_000
// covers a night shift and the 11 h rest before the next one
const LOOKBACK_MS = 36 * 3600_000
const SPLIT_PIECE_MIN = 15

const r2 = (n: number) => Math.round(n * 100) / 100

/** Refuses a clock-in at `t` (epoch ms) while the legal minimum break or daily rest is not yet complete. */
export function ensureLegalRest(user: User, t: number): void {
  const st = getAllSettings()
  if (!st.break_enforcement || !active(rulesFrom(st), user) || user.recordingMode !== "full") return
  const day = workingDay(user, t)
  ensureBreakTaken(t, day)
  ensureDailyRest(t, day)
}

interface Block {
  day: string
  startMs: number
  endMs: number
  work: { a: number; b: number }[]
}

/**
 * The working day a clock-in at `t` belongs to: entries merged into blocks (gaps under 3 h), each block on the
 * local day it starts; a clock-in within 3 h of the last block continues it (a night shift stays one day).
 */
function workingDay(user: User, t: number): { day: string; blocks: Block[]; previous: Block | null } {
  const from = instantOfMs(t - LOOKBACK_MS)
  const blocks: Block[] = []
  for (const e of entriesBetween(user.id, from, instantOfMs(t))) {
    if (!e.endAt) continue
    const a = ms(e.startAt)
    const b = Math.min(ms(e.endAt), t)
    if (b <= a) continue
    const cur = blocks.at(-1)
    if (cur && a - cur.endMs < BLOCK_GAP_MS) cur.endMs = Math.max(cur.endMs, b)
    else blocks.push({ day: localDateOf(e.startAt, user.timezone), startMs: a, endMs: b, work: [] })
    if (e.kind === "work") blocks.at(-1)!.work.push({ a, b })
  }
  const withWork = blocks.filter((b) => b.work.length)
  const last = withWork.at(-1)
  const day = last && t - last.endMs < BLOCK_GAP_MS ? last.day : localDateOf(instantOfMs(t), user.timezone)
  const today = withWork.filter((b) => b.day === day)
  const previous = withWork.findLast((b) => b.day < day) ?? null
  return { day, blocks: today, previous }
}

function ensureBreakTaken(t: number, { blocks }: ReturnType<typeof workingDay>): void {
  const segments = blocks.flatMap((b) => b.work).sort((x, y) => x.a - y.a)
  const workedMs = segments.reduce((sum, s) => sum + s.b - s.a, 0)
  const required = breakRequiredMin(workedMs / 60000)
  if (!required) return
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

/** Only the first clock-in of a working day needs the rest; later ones end a break. */
function ensureDailyRest(t: number, { blocks, previous }: ReturnType<typeof workingDay>): void {
  if (blocks.length || !previous) return
  if (t - previous.endMs >= MIN_REST_MIN * 60000) return
  throw new Conflict("The daily rest of 11 hours is not complete yet", {
    code: "rest_required",
    fields: { requiredMin: MIN_REST_MIN, earliest: iso(instantOfMs(previous.endMs + MIN_REST_MIN * 60000)) },
  })
}
