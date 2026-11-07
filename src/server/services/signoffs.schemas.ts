/** Inputs and constants of signoffs (client-safe: referenced by server-function validators). */
import { z } from "zod"

export const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export const signInput = z.object({
  month: monthString,
  userIds: z.array(z.number().int().positive()).min(1).max(500),
  note: z.string().max(500).default(""),
})

export const overviewInput = z.object({ month: monthString.nullish(), teamId: z.number().int().positive().nullish() })

export const listSignoffsInput = z.object({
  month: monthString.nullish(),
  userId: z.number().int().positive().nullish(),
})
