import type { QueryClient } from "@tanstack/react-query"

/** Everything that derives from time entries (views, clock, balances, findings). */
export function invalidateTimeData(qc: QueryClient): Promise<unknown> {
  return Promise.all(
    [["time"], ["clock"], ["account"], ["compliance"], ["absences"]].map((queryKey) =>
      qc.invalidateQueries({ queryKey }),
    ),
  )
}
