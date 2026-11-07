/** Holiday calendar inputs (client-safe: referenced by server-function validators). */
import { z } from "zod"

export const COMPANY_DAY_KEYS = ["dec24_pm", "dec31_pm", "berchtold", "sechselaeuten_pm", "knabenschiessen_pm"] as const
export type CompanyDayKey = (typeof COMPANY_DAY_KEYS)[number]
export const companyDayKey = z.enum(COMPANY_DAY_KEYS)
