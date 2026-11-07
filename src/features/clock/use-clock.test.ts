import { describe, expect, it } from "vitest"
import { type LiveClock, liveSinceSec, liveWorkedMin, primaryAction } from "./use-clock"

const base: LiveClock = {
  state: "working",
  entry: null,
  since: "2026-11-06T07:00:00.000Z",
  todayWorkedMin: 60,
  todayBreakMin: 0,
  serverTime: "2026-11-06T08:00:00.000Z",
  receivedAt: 1_000_000,
}

describe("live clock figures", () => {
  it("ticks only while working and renders the server figures before hydration", () => {
    expect(liveWorkedMin(base, 0)).toBe(60)
    expect(liveWorkedMin(base, 1_000_000 + 30 * 60_000)).toBe(90)
    expect(liveWorkedMin({ ...base, state: "idle" }, 1_000_000 + 30 * 60_000)).toBe(60)
  })

  it("measures the running state against the server clock", () => {
    expect(liveSinceSec(base, 0)).toBe(3600)
    expect(liveSinceSec(base, 1_000_000 + 10_000)).toBe(3610)
  })

  it("picks the primary action per state", () => {
    expect(primaryAction("idle")).toBe("start")
    expect(primaryAction("working")).toBe("stop")
    expect(primaryAction("on_break")).toBe("resume")
  })
})
