/** Inputs and constants of team (client-safe: referenced by server-function validators). */
import { z } from "zod"

export const overviewInput = z.object({
  teamId: z.number().int().positive().nullish(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullish(),
})
