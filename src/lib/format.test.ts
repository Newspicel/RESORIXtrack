import { describe, expect, it } from "vitest"
import { fmtDayRange } from "./format"

describe("fmtDayRange", () => {
  const year = { day: "numeric", month: "short", year: "numeric" } as const
  it("writes the shared month and year once", () => {
    expect(fmtDayRange("2026-11-02", "2026-11-08", "de-CH", year)).toBe("2.–8. Nov. 2026")
    expect(fmtDayRange("2026-10-26", "2026-11-01", "de-CH", year)).toBe("26. Okt. – 1. Nov. 2026")
  })
  it("uses plain spaces and drops the Italian zero padding", () => {
    expect(fmtDayRange("2026-11-02", "2026-11-08", "it-CH", year)).toBe("2–8 nov 2026")
    expect(fmtDayRange("2026-10-26", "2026-11-01", "en-GB", year)).toBe("26 Oct – 1 Nov 2026")
  })
  it("is a single day when both ends match", () => {
    expect(fmtDayRange("2026-11-02", "2026-11-02", "de-CH")).toBe("2. Nov.")
  })
})
