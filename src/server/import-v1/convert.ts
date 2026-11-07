/**
 * Value conversion from RESORIXtrack 1.x storage (SQLAlchemy on SQLite) to the v2 formats (db/columns.ts).
 * v1 stores naive UTC `YYYY-MM-DD HH:MM:SS[.ffffff]`, times of day `HH:MM:SS[.ffffff]`, JSON as text.
 */

const V1_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|[+-]00:?00)?$/
const V1_TIME = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/

export class ConversionError extends Error {}

/** Text of a v1 value; JSON columns have NUMERIC affinity in v1, so a stored `25.0` may come back as a number. */
export const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v))

/** v1 naive UTC timestamp → `YYYY-MM-DDTHH:MM:SS.ffffffZ` (microseconds kept: v1 seals fingerprint them). */
export function v1Instant(value: unknown): string | null {
  if (value == null || value === "") return null
  const m = V1_DATETIME.exec(text(value))
  if (!m) throw new ConversionError(`not a v1 timestamp: ${text(value)}`)
  return `${m[1]}T${m[2]}.${(m[3] ?? "").padEnd(6, "0")}Z`
}

export function v1InstantRequired(value: unknown): string {
  const v = v1Instant(value)
  if (v == null) throw new ConversionError("missing timestamp")
  return v
}

/** v1 naive UTC timestamp → epoch milliseconds (Better Auth's integer timestamp columns). */
export function v1EpochMs(value: unknown): number | null {
  const v = v1Instant(value)
  return v == null ? null : Temporal.Instant.from(v).epochMilliseconds
}

/** v1 `HH:MM:SS[.ffffff]` → `HH:MM`. */
export function v1Clock(value: unknown): string | null {
  if (value == null || value === "") return null
  const m = V1_TIME.exec(text(value))
  if (!m) throw new ConversionError(`not a v1 time of day: ${text(value)}`)
  return `${m[1]}:${m[2]}`
}

export function v1Bool(value: unknown): number {
  if (typeof value === "string") return ["1", "true"].includes(value.toLowerCase()) ? 1 : 0
  return value ? 1 : 0
}

/** JSON text is copied as is; SQL NULL and JSON `null` both become SQL NULL. */
export function v1JsonOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = text(value)
  return s.trim() === "null" ? null : s
}
