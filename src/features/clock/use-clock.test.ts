import { describe, expect, it } from "vitest"
import { makeI18n } from "@/lib/i18n-core"
import {
  advance,
  clockErrorText,
  type LiveClock,
  liveSinceSec,
  liveWorkedMin,
  primaryAction,
  scheduledTimeText,
  schedulesLater,
  secondaryAction,
} from "./use-clock"

const base: LiveClock = {
  state: "working",
  entry: null,
  since: "2026-11-06T07:00:00.000Z",
  scheduledEnd: null,
  todayWorkedMin: 60,
  todayBreakMin: 0,
  breakProjectId: null,
  serverTime: "2026-11-06T08:00:00.000Z",
  receivedAt: 1_000_000,
}
const zurich = { timezone: "Europe/Zurich", timeFormat: "24h" }

describe("live clock figures", () => {
  it("ticks only while working and renders the server figures before hydration", () => {
    expect(liveWorkedMin(base, 0)).toBe(60)
    expect(liveWorkedMin(base, 1_000_000 + 30 * 60_000)).toBe(90)
    expect(liveWorkedMin({ ...base, state: "idle" }, 1_000_000 + 30 * 60_000)).toBe(60)
  })

  it("stops ticking at a scheduled clock-out", () => {
    const planned = { ...base, scheduledEnd: "2026-11-06T08:10:00.000Z" }
    expect(liveWorkedMin(planned, 1_000_000 + 5 * 60_000)).toBe(65)
    expect(liveWorkedMin(planned, 1_000_000 + 30 * 60_000)).toBe(70)
  })

  it("measures the running state against the server clock", () => {
    expect(liveSinceSec(base, 0)).toBe(3600)
    expect(liveSinceSec(base, 1_000_000 + 10_000)).toBe(3610)
  })

  it("picks the primary action per state", () => {
    expect(primaryAction("idle")).toBe("start")
    expect(primaryAction("working")).toBe("stop")
    expect(primaryAction("on_break")).toBe("start")
    expect(secondaryAction("idle")).toBeNull()
    expect(secondaryAction("working")).toBe("pause")
    expect(secondaryAction("on_break")).toBe("stop")
  })
})

describe("optimistic transitions", () => {
  const now = Date.parse("2026-11-06T08:00:00Z")

  it("tells a scheduled clock-out from a plain one", () => {
    expect(schedulesLater(undefined, now)).toBe(false)
    expect(schedulesLater("2026-11-06T08:01:00Z", now)).toBe(false)
    expect(schedulesLater("2026-11-06T10:00:00Z", now)).toBe(true)
  })

  it("keeps working with a plan, clears the plan on unschedule and on a real clock-out", () => {
    const planned = advance(base, "stop", "2026-11-06T10:00:00Z", now)
    expect(planned).toMatchObject({ state: "working", scheduledEnd: "2026-11-06T10:00:00Z" })
    expect(advance(planned, "unschedule", "2026-11-06T08:00:00Z", now)).toMatchObject({
      state: "working",
      scheduledEnd: null,
    })
    expect(advance(planned, "stop", "2026-11-06T08:00:00Z", now)).toMatchObject({ state: "idle", scheduledEnd: null })
    expect(advance({ ...base, state: "idle" }, "start", "2026-11-06T08:00:00Z", now)).toMatchObject({
      state: "working",
      since: "2026-11-06T08:00:00Z",
    })
  })

  it("a break keeps the project for the clock-in that ends it", () => {
    const entry = { projectId: 7 } as NonNullable<LiveClock["entry"]>
    const paused = advance({ ...base, entry }, "pause", "2026-11-06T08:00:00Z", now)
    expect(paused).toMatchObject({ state: "on_break", since: "2026-11-06T08:00:00Z", breakProjectId: 7, entry: null })
    expect(advance(paused, "pause", "2026-11-06T08:05:00Z", now)).toBe(paused)
    expect(advance(paused, "start", "2026-11-06T08:30:00Z", now)).toMatchObject({
      state: "working",
      breakProjectId: null,
    })
    expect(advance(paused, "stop", "2026-11-06T08:30:00Z", now)).toMatchObject({ state: "idle", since: null })
  })
})

describe("legal minimum messages", () => {
  const i18n = makeI18n("en")

  it("words break and rest refusals with the earliest clock-in time", () => {
    expect(scheduledTimeText("2026-11-06T12:55:00Z", zurich)).toBe("13:55")
    expect(scheduledTimeText("2026-11-06T12:55:00Z", { ...zurich, timeFormat: "12h" })).toBe("1:55 PM")
    const brk = { code: "break_required", fields: { required: 30, taken: 10, earliest: "2026-11-06T12:55:00Z" } }
    expect(clockErrorText(brk, i18n, zurich)).toBe(
      "Legal minimum break: 30 min after 7 h of work. You can clock in at 13:55.",
    )
    const rest = { code: "rest_required", fields: { requiredMin: 660, earliest: "2026-11-06T05:30:00Z" } }
    expect(clockErrorText(rest, i18n, zurich)).toBe("Daily rest of 11 hours: you can clock in at 06:30.")
    expect(clockErrorText({ code: "overlap" }, i18n, zurich)).toBeNull()
  })
})
