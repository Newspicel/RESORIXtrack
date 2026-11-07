import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed, tx } from "@/server/middleware"
import { listAllApiKeys, revokeApiKeyAsAdmin } from "@/server/services/api-keys"

export const API_KEY_STATUSES = ["active", "all"] as const
export const apiKeyFilters = z.object({
  status: z.enum(API_KEY_STATUSES).default("all"),
  page: z.number().int().min(1).default(1),
})
export type ApiKeyFilters = z.infer<typeof apiKeyFilters>

export const fetchAllApiKeys = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(apiKeyFilters)
  .handler(({ data, context: { actor } }) => listAllApiKeys(actor, { ...data, pageSize: 50 }))

export const revokeApiKeyAdminFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id: z.number().int().positive(), reason: z.string().trim().max(500) }))
  .handler(({ data, context: { actor } }) => {
    tx(() => revokeApiKeyAsAdmin(actor, data.id, data.reason))
    return { ok: true }
  })

export const allApiKeysQuery = (f: ApiKeyFilters) =>
  queryOptions({ queryKey: ["admin", "api-keys", f], queryFn: () => fetchAllApiKeys({ data: f }) })
