import { beforeEach, describe, expect, it } from "vitest"
import { teamScope, yearAdjustments } from "@/features/team/scope"
import type { AppError } from "@/server/errors"
import { createAdjustment } from "@/server/services/accounts"
import { loadActor, makeEntry, makeOrg } from "@/test/factories"
import { complianceReport } from "./compliance-report"
import { renderReport } from "./render"

function err(fn: () => unknown): AppError {
  try {
    fn()
  } catch (e) {
    return e as AppError
  }
  throw new Error("expected an error")
}

async function rejects(p: Promise<unknown>): Promise<AppError> {
  try {
    await p
  } catch (e) {
    return e as AppError
  }
  throw new Error("expected a rejection")
}

let org: ReturnType<typeof makeOrg>
beforeEach(() => {
  org = makeOrg()
})

describe("compliance report", () => {
  it("lists findings per person of the lead's teams only", () => {
    // 10 h without a break: break_min violation (ArG Art. 15)
    makeEntry(org.anna.id, "2026-11-03T06:00:00.000000Z", "2026-11-03T16:00:00.000000Z")
    const d = complianceReport(loadActor(org.lead.id), { from: "2026-11-01", to: "2026-11-30" })
    expect(d.rows.map((r) => r.name).sort()).toEqual(["Anna Muster", "Ben Beispiel", "Lea Lead"])
    const anna = d.rows.find((r) => r.userId === org.anna.id)!
    expect(anna.counts.violation).toBeGreaterThan(0)
    expect(anna.findings.find((f) => f.rule === "break_min")?.ref).toBe("ArG Art. 15")
    expect(anna.overtime.limitMin).toBe(170 * 60)
  })

  it("is for leads and HR only and checks the range", () => {
    expect(err(() => complianceReport(loadActor(org.anna.id), { from: "2026-11-01", to: "2026-11-30" })).code).toBe(
      "forbidden",
    )
    expect(err(() => complianceReport(loadActor(org.hr!.id), { from: "2026-11-30", to: "2026-11-01" })).code).toBe(
      "validation_error",
    )
    const all = complianceReport(loadActor(org.hr!.id), { from: "2026-11-01", to: "2026-11-30", teamId: org.teamB.id })
    expect(all.rows.map((r) => r.userId)).toEqual([org.carl.id])
  })
})

describe("team scope and adjustments", () => {
  it("gives employees only themselves and leads their teams", () => {
    expect(teamScope(loadActor(org.anna.id))).toMatchObject({ people: [{ id: org.anna.id }], teams: [] })
    const lead = teamScope(loadActor(org.lead.id))
    expect(lead.teams.map((t) => t.id)).toEqual([org.teamA.id])
    expect(lead.people.some((p) => p.id === org.carl.id)).toBe(false)
    expect(teamScope(loadActor(org.hr!.id)).teams).toHaveLength(2)
  })

  it("lists today's adjustments and hides other teams' ones", () => {
    createAdjustment(loadActor(org.hr!.id), org.anna.id, {
      account: "time",
      amount: 90,
      reason: "Correction",
      effectiveDate: "2026-11-05",
    })
    expect(yearAdjustments(loadActor(org.lead.id), org.anna.id, 2026).map((a) => a.amount)).toEqual([90])
    expect(err(() => yearAdjustments(loadActor(org.lead.id), org.carl.id, 2026)).code).toBe("not_found")
  })
})

const params = (p: Record<string, string>) => new URLSearchParams(p)

describe("report files", () => {
  it("renders the timesheet as PDF, XLSX and CSV", async () => {
    makeEntry(org.anna.id, "2026-11-03T07:00:00.000000Z", "2026-11-03T15:00:00.000000Z")
    const lead = loadActor(org.lead.id)
    const q = params({ userId: String(org.anna.id), year: "2026", month: "11" })
    const pdf = await renderReport(lead, "timesheet", "pdf", q)
    expect(new TextDecoder().decode(pdf.body.slice(0, 5))).toBe("%PDF-")
    expect(pdf.filename).toMatch(/anna-muster-2026-11\.pdf$/)
    const xlsx = await renderReport(lead, "timesheet", "xlsx", q)
    expect(xlsx.body[0]).toBe(0x50) // zip
    const raw = (await renderReport(lead, "timesheet", "csv", q)).body
    expect(Array.from(raw.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM
    const csv = new TextDecoder().decode(raw)
    expect(csv).toContain("2026-11-03")
    expect(csv.split("\r\n")[0]).toContain(",")
  })

  it("uses semicolons for German and refuses PDF for raw entries", async () => {
    const hr = loadActor(org.hr!.id)
    hr.user.locale = "de"
    const csv = new TextDecoder().decode(
      (await renderReport(hr, "balances", "csv", params({ year: "2026", month: "11" }))).body,
    )
    expect(csv.split("\r\n")[0]).toContain(";")
    expect(
      (await rejects(renderReport(hr, "entries", "pdf", params({ from: "2026-11-01", to: "2026-11-30" })))).code,
    ).toBe("validation_error")
    const xlsx = await renderReport(hr, "compliance", "xlsx", params({ from: "2026-11-01", to: "2026-11-30" }))
    expect(xlsx.contentType).toContain("spreadsheetml")
  })

  it("lists Sunday, holiday and night hours and the supplement for payroll", async () => {
    // Sunday 8 November 2026, 22:00 to 00:30 local: 60 min Sunday work, 60 min night work (30 more on Monday)
    makeEntry(org.anna.id, "2026-11-08T21:00:00.000000Z", "2026-11-08T23:30:00.000000Z")
    const lead = loadActor(org.lead.id)
    const q = params({ userId: String(org.anna.id), year: "2026", month: "11" })
    const lines = new TextDecoder().decode((await renderReport(lead, "timesheet", "csv", q)).body).split("\r\n")
    const header = lines[0].split(",")
    const row = lines.find((l) => l.startsWith("2026-11-08"))!.split(",")
    const at = (h: string) => row[header.findIndex((x) => x.startsWith(h))]
    expect([at("Sunday"), at("Night"), at("Supplement %")]).toEqual(["1", "1", "50"])
    expect(header.some((h) => h.startsWith("Time credit"))).toBe(false)
    const pdf = await renderReport(loadActor(org.hr!.id), "balances", "pdf", params({ year: "2026", month: "11" }))
    expect(new TextDecoder().decode(pdf.body.slice(0, 5))).toBe("%PDF-")
  })

  it("renders Italian PDFs and semicolon CSVs", async () => {
    const hr = loadActor(org.hr!.id)
    hr.user.locale = "it"
    const q = params({ year: "2026", month: "11" })
    const pdf = await renderReport(hr, "balances", "pdf", q)
    expect(new TextDecoder().decode(pdf.body.slice(0, 5))).toBe("%PDF-")
    expect(pdf.filename).toMatch(/^saldi/)
    const csv = new TextDecoder().decode((await renderReport(hr, "balances", "csv", q)).body)
    expect(csv.split("\r\n")[0]).toContain(";")
  })

  it("keeps report scope: other teams and employees' raw data are refused", async () => {
    const lead = loadActor(org.lead.id)
    expect(
      (
        await rejects(
          renderReport(lead, "timesheet", "pdf", params({ userId: String(org.carl.id), year: "2026", month: "11" })),
        )
      ).code,
    ).toBe("not_found")
    expect(
      (
        await rejects(
          renderReport(loadActor(org.anna.id), "entries", "csv", params({ from: "2026-11-01", to: "2026-11-30" })),
        )
      ).code,
    ).toBe("forbidden")
  })
})
