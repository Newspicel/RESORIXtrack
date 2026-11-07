import { z } from "zod"
import { type Locale, localeSchema } from "@/lib/locales"

export const WEEKLY_MAX = ["45", "50"] as const
export type WeeklyMax = (typeof WEEKLY_MAX)[number]

/** Weekly maximum (ArG art. 9) as the toggle value. */
export function weeklyMaxValue(hours: number): WeeklyMax {
  return hours === 50 ? "50" : "45"
}

/** Select values are strings; "0" stands for "none". */
export interface UserFormValues {
  name: string
  email: string
  role: "admin" | "employee"
  hr: boolean
  projects: boolean
  teamId: string
  holidayCalendarId: string
  timezone: string
  locale: Locale
  employmentStart: string
  employmentEnd: string
  birthDate: string
  vacationDaysPerYear: number
  legalWeeklyMaxHours: WeeklyMax
  recordingMode: "full" | "simplified" | "waived"
  argExempt: boolean
  regularNightWork: boolean
  pensumPercent: number
  sendInvite: boolean
}

const req = "errors.fields.required"
const inv = "errors.fields.invalid"
const optDay = z.string().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), inv)

export const userFormSchema = z
  .object({
    name: z.string().trim().min(1, req).max(120, "errors.fields.too_long"),
    email: z
      .string()
      .trim()
      .min(1, req)
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, inv),
    role: z.enum(["admin", "employee"]),
    hr: z.boolean(),
    projects: z.boolean(),
    teamId: z.string(),
    holidayCalendarId: z.string(),
    timezone: z.string().min(1, req),
    locale: localeSchema,
    employmentStart: optDay,
    employmentEnd: optDay,
    birthDate: optDay,
    vacationDaysPerYear: z.number({ error: req }).min(0, inv).max(366, inv),
    legalWeeklyMaxHours: z.enum(WEEKLY_MAX),
    recordingMode: z.enum(["full", "simplified", "waived"]),
    argExempt: z.boolean(),
    regularNightWork: z.boolean(),
    pensumPercent: z.number({ error: req }).min(1, inv).max(100, inv),
    sendInvite: z.boolean(),
  })
  .refine((v) => !v.employmentStart || !v.employmentEnd || v.employmentEnd >= v.employmentStart, {
    path: ["employmentEnd"],
    message: "errors.fields.before_start",
  })

export function toPayload(v: UserFormValues) {
  return {
    name: v.name.trim(),
    email: v.email.trim(),
    role: v.role,
    capabilities: [...(v.hr ? (["hr"] as const) : []), ...(v.projects ? (["projects"] as const) : [])],
    teamId: Number(v.teamId) || null,
    holidayCalendarId: Number(v.holidayCalendarId) || null,
    timezone: v.timezone,
    locale: v.locale,
    employmentStart: v.employmentStart || null,
    employmentEnd: v.employmentEnd || null,
    birthDate: v.birthDate || null,
    vacationDaysPerYear: v.vacationDaysPerYear,
    legalWeeklyMaxHours: v.legalWeeklyMaxHours === "50" ? (50 as const) : (45 as const),
    recordingMode: v.recordingMode,
    argExempt: v.argExempt,
    regularNightWork: v.regularNightWork,
  }
}
