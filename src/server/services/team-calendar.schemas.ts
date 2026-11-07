/** Inputs and constants of team-calendar (client-safe: referenced by server-function validators). */
import { z } from "zod"
import { dayString } from "./absences.schemas"

export const calendarInput = z.object({
  from: dayString,
  to: dayString,
  teamId: z.number().int().positive().nullish(),
})
