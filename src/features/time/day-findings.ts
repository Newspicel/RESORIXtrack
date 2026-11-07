import type { Finding } from "./day-marks"
import type { Day } from "./entry-dialog"

/** Findings attached to a day (break rule also from the account warnings when checks are off). */
export function dayFindings(day: Day, findings: Finding[]): Finding[] {
  const own = findings.filter((f) => f.date === day.date)
  if (day.warnings.includes("break_too_short") && !own.some((f) => f.rule === "break_min")) {
    own.push({
      rule: "break_min",
      severity: "warning",
      date: day.date,
      value: day.breakMin,
      limit: 0,
      ref: "ArG Art. 15",
    })
  }
  return own
}
