import { describe, expect, it } from "vitest"
import { fmtClockTime, minToHhmm, minutesOfDay, parseDuration, parseTimeText, wallClock, wallToInstant } from "./lib"

describe("time lib", () => {
  it("parses typed times leniently", () => {
    expect(parseTimeText("9")).toBe("09:00")
    expect(parseTimeText("930")).toBe("09:30")
    expect(parseTimeText("9.30")).toBe("09:30")
    expect(parseTimeText("17:05")).toBe("17:05")
    expect(parseTimeText("9:30 pm")).toBe("21:30")
    expect(parseTimeText("12 am")).toBe("00:00")
    expect(parseTimeText("24:00")).toBeNull()
    expect(parseTimeText("abc")).toBeNull()
  })

  it("parses durations", () => {
    expect(parseDuration("7:30")).toBe(450)
    expect(parseDuration("7.5")).toBe(450)
    expect(parseDuration("7,25")).toBe(435)
    expect(parseDuration("90m")).toBe(90)
    expect(parseDuration("")).toBeNull()
    expect(parseDuration("x")).toBeNull()
  })

  it("converts wall-clock times in a zone, across DST", () => {
    expect(wallToInstant("2026-11-06", "08:00", "Europe/Zurich")).toBe("2026-11-06T07:00:00.000Z")
    expect(wallToInstant("2026-07-01", "08:00", "Europe/Zurich")).toBe("2026-07-01T06:00:00.000Z")
    expect(wallClock("2026-03-29T01:30:00Z", "Europe/Zurich")).toEqual({
      date: "2026-03-29",
      time: "03:30",
      seconds: 0,
    })
    expect(minutesOfDay("2026-11-06T22:45:00Z", "Europe/Zurich")).toBe(23 * 60 + 45)
  })

  it("formats times of day", () => {
    expect(minToHhmm(1500)).toBe("01:00")
    expect(fmtClockTime("13:05", true)).toBe("1:05 PM")
    expect(fmtClockTime("00:10", true)).toBe("12:10 AM")
    expect(fmtClockTime("13:05", false)).toBe("13:05")
  })
})
