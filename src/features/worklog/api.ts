import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { Validation } from "@/server/errors"
import { authed, tx } from "@/server/middleware"
import { canManageProjects } from "@/server/services/permissions"
import { listProjects, saveProject } from "@/server/services/projects"
import { addLog, deleteLog, listLogs, recentCustomerRefs, updateLog } from "@/server/services/worklog"

const id = z.number().int().positive()
const day = z.iso.date()
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const reason = z.string().max(500).default("")

export const fetchWorklog = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ userId: id.nullish(), from: day, to: day, includeDeleted: z.boolean().default(false) }))
  .handler(({ data, context: { actor } }) => {
    if (data.to < data.from) throw new Validation("'to' is before 'from'", { fields: { to: "before_start" } })
    return listLogs(actor, data.userId ?? actor.id, data.from, data.to, data.includeDeleted)
  })

export const worklogQuery = (p: { userId?: number | null; from: string; to: string; includeDeleted?: boolean }) =>
  queryOptions({ queryKey: ["worklog", p], queryFn: () => fetchWorklog({ data: p }) })

const item = {
  minutes: z.number().int().min(1).max(1440).nullish(),
  startTime: hhmm.nullish(),
  endTime: hhmm.nullish(),
  projectId: id.nullish(),
  customerRef: z.string().max(60).optional(),
  note: z.string().max(2000).optional(),
}

export const addWorklogFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ userId: id.nullish(), date: day, ...item, reason }))
  .handler(({ data, context: { actor } }) => tx(() => addLog(actor, data)))

export const updateWorklogFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, date: day.optional(), ...item, reason }))
  .handler(({ data: { id: logId, reason: why, ...patch }, context: { actor } }) =>
    tx(() => updateLog(actor, logId, patch, why)),
  )

export const deleteWorklogFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, reason }))
  .handler(({ data, context: { actor } }) => tx(() => deleteLog(actor, data.id, data.reason)))

export const fetchCustomerRefs = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => recentCustomerRefs(actor.user))

export const customerRefsQuery = () =>
  queryOptions({ queryKey: ["worklog", "customer-refs"], queryFn: () => fetchCustomerRefs() })

// ------------------------------------------------------------------ projects

export const fetchProjects = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ includeInactive: z.boolean().default(false) }))
  .handler(({ data, context: { actor } }) => ({
    items: listProjects(actor, data.includeInactive),
    canCreate: actor.caps.has("projects") || actor.ledTeamIds.size > 0,
    canCreateCompanyWide: canManageProjects(actor, null),
    teamIds: actor.caps.has("projects") ? null : [...actor.ledTeamIds],
  }))

export const projectsQuery = (includeInactive = false) =>
  queryOptions({ queryKey: ["projects", includeInactive], queryFn: () => fetchProjects({ data: { includeInactive } }) })

const project = {
  name: z.string().min(1).max(120),
  code: z.string().max(30).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  description: z.string().max(500).optional(),
  teamId: id.nullish(),
  isActive: z.boolean().optional(),
}

export const createProjectFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object(project))
  .handler(({ data, context: { actor } }) => tx(() => saveProject(actor, data)))

export const updateProjectFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, ...project, name: project.name.optional() }))
  .handler(({ data: { id: projectId, ...input }, context: { actor } }) =>
    tx(() => saveProject(actor, input, projectId)),
  )
