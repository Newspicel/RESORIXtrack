import { inArray } from "drizzle-orm"
import type { z } from "zod"
import { db } from "@/server/db"
import { teams } from "@/server/db/schema"
import { Forbidden, Validation } from "@/server/errors"
import { countFindings, type Finding, overtimeYear, periodFindings, yearFindings } from "@/server/services/compliance"
import { type Actor, isManager } from "@/server/services/permissions"
import { getSetting } from "@/server/services/settings"
import { scopeUsers } from "@/server/services/signoffs"
import { complianceReportInput } from "./compliance-report.schemas"

export { complianceReportInput }

const SEVERITY_ORDER = { violation: 0, warning: 1, info: 2 } as const

function when(f: Finding): string {
  return f.date ?? f.week ?? String(f.year ?? "")
}

/**
 * Labour-law findings per person for a period plus the Überzeit tally of the year the period ends in
 * (leads: their teams, HR: everyone). Compliance never blocks; this is the inspectorate view.
 */
export function complianceReport(actor: Actor, raw: z.input<typeof complianceReportInput>) {
  if (!isManager(actor)) throw new Forbidden("Only team leads and HR see compliance reports")
  const input = complianceReportInput.parse(raw)
  if (input.to < input.from) throw new Validation("'to' is before 'from'", { fields: { to: "before_start" } })
  if (Temporal.PlainDate.from(input.from).until(input.to).days > 400)
    throw new Validation("Range too large", { fields: { to: "too_long" } })
  const year = Number(input.to.slice(0, 4))
  const people = scopeUsers(actor, { teamId: input.teamId, userId: input.userId, periodStart: input.from })
  const teamIds = [...new Set(people.map((u) => u.teamId).filter((x): x is number => x != null))]
  const teamNames = new Map(
    teamIds.length
      ? db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, teamIds))
          .all()
          .map((t) => [t.id, t.name])
      : [],
  )
  const rows = people.map((u) => {
    const findings = [...periodFindings(u, input.from, input.to), ...yearFindings(u, year)].sort(
      (a, b) => when(a).localeCompare(when(b)) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    )
    const o = overtimeYear(u, year)
    return {
      userId: u.id,
      name: u.name,
      team: u.teamId != null ? (teamNames.get(u.teamId) ?? null) : null,
      recordingMode: u.recordingMode,
      argExempt: u.argExempt,
      counts: countFindings(findings),
      findings,
      overtime: {
        year,
        weeklyMaxHours: o.weeklyMaxHours,
        overtimeMin: o.overtimeMin,
        limitMin: o.limitMin,
        warnAtMin: o.warnAtMin,
      },
    }
  })
  return {
    report: "compliance" as const,
    start: input.from,
    end: input.to,
    year,
    rows,
    company: getSetting("company_name"),
  }
}
export type ComplianceReportData = ReturnType<typeof complianceReport>
