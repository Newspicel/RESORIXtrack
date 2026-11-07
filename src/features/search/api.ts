import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed } from "@/server/middleware"
import { globalSearch } from "@/server/services/search"

export const searchFn = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ q: z.string().max(80) }))
  .handler(({ data, context: { actor } }) => globalSearch(actor, data.q))
