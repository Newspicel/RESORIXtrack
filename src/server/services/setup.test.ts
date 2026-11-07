import { eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"
import { db } from "../db"
import { absenceTypes, holidayCalendars, users, workSchedules } from "../db/schema"
import { env } from "../env"
import { getSetting } from "./settings"
import { completeSetup, ensureSetupCode, generateSetupCode, setupNeeded, verifySetupCode } from "./setup"
import { hasPassword } from "./user-auth"

const INPUT = {
  companyName: "Example AG",
  locale: "de",
  timezone: "Europe/Zurich",
  fulltimeWeeklyMinutes: 2400,
  defaultVacationDays: 25,
  holidayPreset: "CH-ZH",
  adminName: "Ada Admin",
  adminEmail: "Ada@Example.nomail",
  adminPassword: "a long passphrase",
}

describe("setup code", () => {
  it("is generated once, stored hashed and verified case-insensitively", () => {
    const code = ensureSetupCode() as string
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(ensureSetupCode()).toBeNull()
    expect(verifySetupCode(code.toLowerCase().replace(/-/g, " "))).toBe(true)
    expect(verifySetupCode("AAAA-BBBB-CCCC")).toBe(false)
    const fresh = generateSetupCode()
    expect(verifySetupCode(code)).toBe(false)
    expect(verifySetupCode(fresh)).toBe(true)
  })
})

describe("setup wizard", () => {
  it("requires the code when configured, then creates settings, types, holidays and the administrator", async () => {
    vi.spyOn(env, "setupCodeRequired", "get").mockReturnValue(true)
    const code = generateSetupCode()
    await expect(completeSetup({ ...INPUT, setupCode: "WRONG-CODE-XXXX" })).rejects.toMatchObject({
      code: "setup_code_invalid",
    })
    await expect(completeSetup({ ...INPUT, setupCode: code, adminPassword: "short" }, null)).rejects.toMatchObject({
      code: "password_too_short",
    })
    expect(setupNeeded()).toBe(true)

    const { admin, holidaysInstalled } = await completeSetup({ ...INPUT, setupCode: code })
    vi.restoreAllMocks()
    expect(admin).toMatchObject({
      email: "ada@example.nomail",
      role: "admin",
      capabilities: ["hr", "projects"],
      locale: "de",
    })
    expect(hasPassword(admin.id)).toBe(true)
    expect(getSetting("company_name")).toBe("Example AG")
    expect(getSetting("fulltime_weekly_minutes")).toBe(2400)
    expect(getSetting("setup_complete")).toBe(true)
    expect(db.select().from(absenceTypes).all().length).toBeGreaterThan(0)
    expect(db.select().from(workSchedules).where(eq(workSchedules.userId, admin.id)).get()).toMatchObject({
      minutesMon: 480,
      minutesSat: 0,
    })
    expect(holidaysInstalled).toBe(true)
    expect(db.select().from(holidayCalendars).where(eq(holidayCalendars.isDefault, true)).get()).toBeTruthy()
    expect(verifySetupCode(code)).toBe(false)
    await expect(completeSetup({ ...INPUT, setupCode: code })).rejects.toMatchObject({ code: "setup_done" })
  })

  it("finishes without holidays when the preset fails", async () => {
    const { holidaysInstalled } = await completeSetup({ ...INPUT, holidayPreset: "XX-NOPE" })
    expect(holidaysInstalled).toBe(false)
    expect(db.select().from(users).all()).toHaveLength(1)
    expect(getSetting("setup_complete")).toBe(true)
  })
})
