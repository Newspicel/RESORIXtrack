import { describe, expect, it } from "vitest"
import { renderMail } from "./render"

const ctx = { company: "ACME", baseUrl: "http://x", accent: "#35a1cc", hasLogo: false }

describe("mail variables from services", () => {
  it("renders absence mails from the snake_case payload the absences service sends", () => {
    const m = renderMail(
      "absence_approved",
      "en",
      "Anna",
      {
        actor_name: "Luca",
        type: "Vacation",
        type_key: "vacation",
        start_date: "2026-12-14",
        end_date: "2026-12-18",
        days: 4,
      },
      ctx,
    )
    const text = `${m.subject} ${m.text}`
    expect(text).toContain("Luca")
    expect(text).toMatch(/14/)
    expect(text).not.toMatch(/someone/i)
  })

  it("renders corrections with local wall times", () => {
    const m = renderMail(
      "entry_corrected",
      "de",
      "Anna",
      {
        actor_name: "Luca",
        action: "update",
        reason: "Vergessen",
        local_start: "2026-11-05 08:00",
        local_end: "2026-11-05 17:00",
      },
      ctx,
    )
    expect(m.text).toContain("08:00")
    expect(m.text).toContain("17:00")
    expect(m.text).toContain("Luca")
  })

  it("has an absence_changed template", () => {
    const m = renderMail(
      "absence_changed",
      "fr",
      "Anna",
      { actor_name: "Luca", type: "Vacances", start_date: "2026-12-14", end_date: "2026-12-18" },
      ctx,
    )
    expect(m.subject).toContain("Vacances")
  })
})
