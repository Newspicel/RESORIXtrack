import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import type { z } from "zod"
import { complianceReport } from "@/features/reports/compliance-report"
import { complianceReportInput } from "@/features/reports/compliance-report.schemas"
import { authed } from "@/server/middleware"
import { absencesReport, balances, projectHours, rawEntries, timesheet } from "@/server/services/reports"
import { balancesInput, rangeInput, timesheetInput } from "@/server/services/reports.schemas"

export const fetchTimesheet = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(timesheetInput)
  .handler(({ data, context: { actor } }) => timesheet(actor, data))

export const fetchBalancesReport = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(balancesInput)
  .handler(({ data, context: { actor } }) => balances(actor, data))

export const fetchAbsencesReport = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(rangeInput)
  .handler(({ data, context: { actor } }) => absencesReport(actor, data))

export const fetchProjectHours = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(rangeInput)
  .handler(({ data, context: { actor } }) => projectHours(actor, data))

export const fetchRawEntries = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(rangeInput)
  .handler(({ data, context: { actor } }) => rawEntries(actor, data))

type TimesheetParams = z.input<typeof timesheetInput>
type BalancesParams = z.input<typeof balancesInput>
type RangeParams = z.input<typeof rangeInput>

export const timesheetQuery = (params: TimesheetParams) =>
  queryOptions({ queryKey: ["reports", "timesheet", params], queryFn: () => fetchTimesheet({ data: params }) })
export const balancesReportQuery = (params: BalancesParams) =>
  queryOptions({ queryKey: ["reports", "balances", params], queryFn: () => fetchBalancesReport({ data: params }) })
export const absencesReportQuery = (params: RangeParams) =>
  queryOptions({ queryKey: ["reports", "absences", params], queryFn: () => fetchAbsencesReport({ data: params }) })
export const projectHoursQuery = (params: RangeParams) =>
  queryOptions({ queryKey: ["reports", "projects", params], queryFn: () => fetchProjectHours({ data: params }) })
export const rawEntriesQuery = (params: RangeParams) =>
  queryOptions({ queryKey: ["reports", "entries", params], queryFn: () => fetchRawEntries({ data: params }) })

export const fetchComplianceReport = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(complianceReportInput)
  .handler(({ data, context: { actor } }) => complianceReport(actor, data))

export const complianceReportQuery = (params: z.input<typeof complianceReportInput>) =>
  queryOptions({ queryKey: ["reports", "compliance", params], queryFn: () => fetchComplianceReport({ data: params }) })
