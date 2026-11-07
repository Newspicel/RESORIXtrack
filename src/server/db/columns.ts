/**
 * Column types shared by the domain schema.
 *
 * Storage conventions (SQLite):
 * - `instant`  UTC timestamp as fixed-width ISO text with microseconds, `2026-11-06T18:56:07.523543Z`.
 *              Lexicographic order == chronological order, so SQL comparisons and the sign-off triggers
 *              work on the raw text. Microseconds are kept because v1 sign-off seals fingerprint them.
 * - `day`      calendar date `YYYY-MM-DD` (always interpreted in the person's timezone).
 * - `clock`    wall-clock time of day `HH:MM`.
 * - booleans   integer 0/1, JSON as text.
 * Better Auth's own tables use its native integer millisecond timestamps.
 */
import { customType, text } from "drizzle-orm/sqlite-core"

const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

/** Normalise any ISO instant (or Date) to the stored fixed-width microsecond form. */
export function toInstant(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z")
  }
  if (INSTANT_RE.test(value)) return value
  const i = Temporal.Instant.from(value)
  const s = i.toString({ smallestUnit: "microsecond" })
  return s
}

export const instant = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (v) => toInstant(v),
  fromDriver: (v) => v,
})

export const day = (name?: string) => (name ? text(name) : text())
export const clock = (name?: string) => (name ? text(name) : text())
