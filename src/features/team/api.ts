import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { teamScope, yearAdjustments } from "@/features/team/scope"
import { authed } from "@/server/middleware"
import { listAbsences } from "@/server/services/absences"
import { pendingApprovals } from "@/server/services/approvals"
import { isManager, requireView } from "@/server/services/permissions"
import { scheduleEditor } from "@/server/services/schedules"
import { memberDetail, teamOverview } from "@/server/services/team"
import { overviewInput } from "@/server/services/team.schemas"
import { teamCalendar } from "@/server/services/team-calendar"
import { calendarInput } from "@/server/services/team-calendar.schemas"
import { addDays, localToday } from "@/server/time"

const id = z.number().int().positive()

export const fetchTeamOverview = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(overviewInput)
  .handler(({ data, context: { actor } }) => teamOverview(actor, data))

export const fetchTeamCalendar = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(calendarInput)
  .handler(({ data, context: { actor } }) => teamCalendar(actor, data))

export const fetchMember = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => memberDetail(actor, data.id))

/** The approval inbox plus the visible upcoming absences (next 6 months). */
export const fetchApprovals = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => {
    const today = localToday(actor.user.timezone)
    return {
      pending: pendingApprovals(actor),
      upcoming: isManager(actor)
        ? listAbsences(actor, { from: today, to: addDays(today, 180), status: ["approved", "pending"] })
        : [],
    }
  })

type OverviewParams = z.input<typeof overviewInput>
type CalendarParams = z.input<typeof calendarInput>

export const teamOverviewQuery = (params: OverviewParams = {}) =>
  queryOptions({ queryKey: ["team", "overview", params], queryFn: () => fetchTeamOverview({ data: params }) })
export const teamCalendarQuery = (params: CalendarParams) =>
  queryOptions({ queryKey: ["team", "calendar", params], queryFn: () => fetchTeamCalendar({ data: params }) })
export const memberQuery = (userId: number) =>
  queryOptions({ queryKey: ["team", "member", userId], queryFn: () => fetchMember({ data: { id: userId } }) })
export const approvalsQuery = queryOptions({ queryKey: ["team", "approvals"], queryFn: () => fetchApprovals() })

/** People and teams the actor may pick in team views and reports (employees: only themselves). */
export const fetchTeamScope = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => teamScope(actor))

export const teamScopeQuery = queryOptions({
  queryKey: ["team", "scope"],
  queryFn: () => fetchTeamScope(),
  staleTime: 60_000,
})

/** Work schedule versions of one person with the editor context (editable by HR, and leads when allowed). */
export const fetchMemberSchedules = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => scheduleEditor(actor, requireView(actor, data.id).id))

export const memberSchedulesQuery = (userId: number) =>
  queryOptions({
    queryKey: ["team", "member", userId, "schedules"],
    queryFn: () => fetchMemberSchedules({ data: { id: userId } }),
  })

/** Balance adjustments of one person and year (member page; includes today's and future-dated ones). */
export const fetchAdjustments = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ userId: id, year: z.number().int().min(1990).max(2100) }))
  .handler(({ data, context: { actor } }) => yearAdjustments(actor, data.userId, data.year))

export const adjustmentsQuery = (userId: number, year: number) =>
  queryOptions({
    queryKey: ["account", "adjustments", userId, year],
    queryFn: () => fetchAdjustments({ data: { userId, year } }),
  })
