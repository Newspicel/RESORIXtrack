import { addDaysStr, addMonthsStr } from "@/lib/format"

export interface CalendarMark {
  key: string
  /** type colour (data, set by administrators) */
  color: string
  /** short text shown in the cell: type or initials */
  text: string
  /** full description for screen readers and the hover title */
  label: string
  pending?: boolean
  half?: "am" | "pm" | null
}

export interface CalendarCell {
  workday: boolean
  holiday: { name: string; fraction: number } | null
  marks: CalendarMark[]
}

export function monthDays(month: string): string[] {
  const first = `${month}-01`
  const last = addDaysStr(`${addMonthsStr(month, 1)}-01`, -1)
  const out: string[] = []
  for (let d = first; d <= last; d = addDaysStr(d, 1)) out.push(d)
  return out
}

/** Calendar cells from per-day data; `toMark` turns one absence into a chip (or null to skip it). */
export function cellsFrom<D extends { date: string; workday: boolean; holiday: CalendarCell["holiday"] }, A>(
  days: (D & { absences: A[] })[],
  toMark: (a: A, day: D) => CalendarMark | null,
): Map<string, CalendarCell> {
  return new Map(
    days.map((d) => [
      d.date,
      {
        workday: d.workday,
        holiday: d.holiday,
        marks: d.absences.map((a) => toMark(a, d)).filter((m): m is CalendarMark => m !== null),
      },
    ]),
  )
}
