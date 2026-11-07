import type { QueryClient } from "@tanstack/react-query"

/** Everything that derives from time entries or the work log (views, clock, balances, findings). */
export function invalidateTimeData(qc: QueryClient): Promise<unknown> {
  return Promise.all(
    [["time"], ["clock"], ["account"], ["compliance"], ["worklog"], ["absences"]].map((queryKey) =>
      qc.invalidateQueries({ queryKey }),
    ),
  )
}
