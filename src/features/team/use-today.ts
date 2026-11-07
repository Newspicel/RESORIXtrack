import { useSuspenseQuery } from "@tanstack/react-query"
import { teamScopeQuery } from "./api"

/** Today in the viewer's timezone, computed on the server (no SSR/hydration drift). */
export function useToday(): string {
  return useSuspenseQuery(teamScopeQuery).data.today
}
