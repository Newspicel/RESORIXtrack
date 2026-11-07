import { queryOptions, useSuspenseQuery } from "@tanstack/react-query"
import { type Bootstrap, getBootstrap, type Me } from "@/server/fns/session"

export const bootstrapQuery = queryOptions({
  queryKey: ["bootstrap"],
  queryFn: () => getBootstrap(),
  staleTime: 30_000,
})

export function useBootstrap(): Bootstrap {
  return useSuspenseQuery(bootstrapQuery).data
}

/** The signed-in person (only inside the authenticated app layout). */
export function useMe(): Me {
  const me = useBootstrap().me
  if (!me) throw new Error("useMe() outside the authenticated layout")
  return me
}

export type { Bootstrap, Me }
