import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed, tx } from "@/server/middleware"
import { withOutbox } from "@/server/services/outbox"
import {
  listSignoffs,
  reopen,
  serializeSignoffs,
  signOffMany,
  signoffDetail,
  signoffOverview,
  verifyAll,
} from "@/server/services/signoffs"
import { listSignoffsInput, overviewInput, signInput } from "@/server/services/signoffs.schemas"

const id = z.number().int().positive()

export const fetchSignoffOverview = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(overviewInput)
  .handler(({ data, context: { actor } }) => signoffOverview(actor, data))

export const fetchSignoffs = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(listSignoffsInput)
  .handler(({ data, context: { actor } }) => listSignoffs(actor, data))

export const fetchSignoff = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => signoffDetail(actor, data.id))

/** Each person is signed off on their own; the result lists successes and refusals. */
export const signOffFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(signInput)
  .handler(({ data, context: { actor } }) => ({ results: withOutbox(() => tx(() => signOffMany(actor, data))) }))

export const reopenFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, reason: z.string().max(500) }))
  .handler(({ data, context: { actor } }) => serializeSignoffs([tx(() => reopen(actor, data.id, data.reason))])[0])

export const verifySignoffsFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ userId: id.nullish() }))
  .handler(({ data, context: { actor } }) => verifyAll(actor, data.userId))

type OverviewParams = z.input<typeof overviewInput>
type ListParams = z.input<typeof listSignoffsInput>

export const signoffOverviewQuery = (params: OverviewParams = {}) =>
  queryOptions({ queryKey: ["signoff", "overview", params], queryFn: () => fetchSignoffOverview({ data: params }) })
export const signoffsQuery = (params: ListParams = {}) =>
  queryOptions({ queryKey: ["signoff", "list", params], queryFn: () => fetchSignoffs({ data: params }) })
export const signoffQuery = (signoffId: number) =>
  queryOptions({ queryKey: ["signoff", signoffId], queryFn: () => fetchSignoff({ data: { id: signoffId } }) })
