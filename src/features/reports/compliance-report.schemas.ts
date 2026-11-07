import { z } from "zod"
import { dayString } from "@/server/services/absences.schemas"

/** Client-safe input of the compliance report (used by the server function's validator). */
export const complianceReportInput = z.object({
  from: dayString,
  to: dayString,
  teamId: z.number().int().positive().nullish(),
  userId: z.number().int().positive().nullish(),
})
