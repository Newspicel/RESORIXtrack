import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { Validation } from "@/server/errors"
import { authed } from "@/server/middleware"
import { findingsFor, teamComplianceSummary, yearFindingsFor } from "@/server/services/compliance"

const id = z.number().int().positive()
const day = z.iso.date()

function checkRange(from: string, to: string) {
  if (to < from) throw new Validation("'to' is before 'from'", { fields: { to: "before_start" } })
  if (Temporal.PlainDate.from(from).until(to).days > 400)
    throw new Validation("Range too large", { fields: { to: "too_long" } })
}

/** Findings of one person in a period (day and week rules). */
export const fetchFindings = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ userId: id.nullish(), from: day, to: day }))
  .handler(({ data, context: { actor } }) => {
    checkRange(data.from, data.to)
    return findingsFor(actor, data.userId ?? actor.id, data.from, data.to)
  })

export const findingsQuery = (p: { userId?: number | null; from: string; to: string }) =>
  queryOptions({ queryKey: ["compliance", "findings", p], queryFn: () => fetchFindings({ data: p }) })

/** Year rules: Überzeit tally, minimum vacation, two-week vacation block. */
export const fetchYearFindings = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ userId: id.nullish(), year: z.number().int().min(1990).max(2100) }))
  .handler(({ data, context: { actor } }) => yearFindingsFor(actor, data.userId ?? actor.id, data.year))

export const yearFindingsQuery = (p: { userId?: number | null; year: number }) =>
  queryOptions({ queryKey: ["compliance", "year", p], queryFn: () => fetchYearFindings({ data: p }) })

/** Finding counts per person for managers (leads: their teams; HR: everyone). */
export const fetchTeamCompliance = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ from: day, to: day, teamId: id.nullish() }))
  .handler(({ data, context: { actor } }) => {
    checkRange(data.from, data.to)
    return teamComplianceSummary(actor, data.from, data.to, data.teamId)
  })

export const teamComplianceQuery = (p: { from: string; to: string; teamId?: number | null }) =>
  queryOptions({ queryKey: ["compliance", "team", p], queryFn: () => fetchTeamCompliance({ data: p }) })
