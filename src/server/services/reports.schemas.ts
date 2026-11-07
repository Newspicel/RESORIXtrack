/** Inputs and constants of reports (client-safe: referenced by server-function validators). */
import { z } from "zod"
import { dayString } from "./absences.schemas"

export const timesheetInput = z.object({
  userId: z.number().int().positive().nullish(),
  year: z.number().int().min(1990).max(2100),
  month: z.number().int().min(1).max(12),
})

export const balancesInput = z.object({
  year: z.number().int().min(1990).max(2100),
  month: z.number().int().min(1).max(12).nullish(),
  teamId: z.number().int().positive().nullish(),
})

export const rangeInput = z.object({
  from: dayString,
  to: dayString,
  teamId: z.number().int().positive().nullish(),
  userId: z.number().int().positive().nullish(),
})
