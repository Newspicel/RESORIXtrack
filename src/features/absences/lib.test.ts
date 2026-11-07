import { describe, expect, it } from "vitest"
import { monthDays } from "@/components/app/absence-calendar-cells"
import { makeI18n } from "@/lib/i18n-core"
import { formatSpan, nextRange, nextWeekday, normalizeHalves, shortLabel, splitAbsences } from "./lib"

describe("nextRange", () => {
  it("starts a range, ends it with a later day and restarts on an earlier one", () => {
    const a = nextRange(null, "2026-11-10")
    expect(a).toEqual({ start: "2026-11-10", end: "2026-11-10", anchor: "2026-11-10" })
    expect(nextRange(a.anchor, "2026-11-13")).toEqual({ start: "2026-11-10", end: "2026-11-13", anchor: null })
    expect(nextRange(a.anchor, "2026-11-09")).toEqual({ start: "2026-11-09", end: "2026-11-09", anchor: "2026-11-09" })
  })
})

describe("normalizeHalves", () => {
  it("keeps only the start half for a single day", () => {
    expect(normalizeHalves("2026-11-10", "2026-11-10", "am", "am")).toEqual({ startHalf: "am", endHalf: "full" })
  })
  it("allows only an afternoon start and a morning end over several days", () => {
    expect(normalizeHalves("2026-11-10", "2026-11-12", "am", "pm")).toEqual({ startHalf: "full", endHalf: "full" })
    expect(normalizeHalves("2026-11-10", "2026-11-12", "pm", "am")).toEqual({ startHalf: "pm", endHalf: "am" })
  })
})

describe("splitAbsences", () => {
  const base = { startHalf: "full" as const, endHalf: "full" as const }
  const items = [
    { ...base, id: 1, startDate: "2026-03-02", endDate: "2026-03-03", status: "approved" as const },
    { ...base, id: 2, startDate: "2026-11-05", endDate: "2026-11-09", status: "approved" as const },
    { ...base, id: 3, startDate: "2026-12-01", endDate: "2026-12-01", status: "pending" as const },
    { ...base, id: 4, startDate: "2026-12-07", endDate: "2026-12-08", status: "cancelled" as const },
  ]
  it("puts running and future active absences into upcoming, the rest of the year into past", () => {
    const { upcoming, past } = splitAbsences(items, "2026-11-06", 2026)
    expect(upcoming.map((a) => a.id)).toEqual([2, 3])
    expect(past.map((a) => a.id)).toEqual([4, 1])
  })
})

describe("formatting", () => {
  const i = makeI18n("en")
  it("shows halves and the year only outside the current year", () => {
    expect(
      formatSpan({ startDate: "2026-12-07", endDate: "2026-12-07", startHalf: "am", endHalf: "full" }, i, {
        today: "2026-11-06",
      }),
    ).toBe("Mon 7 Dec, Morning")
    expect(
      formatSpan({ startDate: "2026-12-28", endDate: "2027-01-04", startHalf: "pm", endHalf: "am" }, i, {
        today: "2026-11-06",
      }),
    ).toBe("Mon, 28 Dec 2026 (afternoon) – Mon, 4 Jan 2027 (morning)")
    expect(
      formatSpan({ startDate: "2027-01-18", endDate: "2027-01-20", startHalf: "full", endHalf: "full" }, i, {
        today: "2026-11-06",
      }),
    ).toBe("Mon, 18 Jan – Wed, 20 Jan 2027")
    expect(
      formatSpan(
        { startDate: "2027-01-18", endDate: "2027-01-20", startHalf: "full", endHalf: "full" },
        makeI18n("de"),
        {
          today: "2026-11-06",
        },
      ),
    ).toBe("Mo., 18. – Mi., 20. Jan. 2027")
  })
  it("shortens labels and skips weekends", () => {
    expect(shortLabel("Military / civil service")).toBe("Military")
    expect(nextWeekday("2026-11-06")).toBe("2026-11-09")
    expect(nextWeekday("2026-11-09")).toBe("2026-11-10")
  })
  it("lists the days of a month", () => {
    expect(monthDays("2028-02")).toHaveLength(29)
    expect(monthDays("2026-11").at(-1)).toBe("2026-11-30")
  })
})
