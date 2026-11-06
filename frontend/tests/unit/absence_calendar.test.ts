import { describe, expect, it } from "vitest";
import { nextRange } from "../../src/components/absence_calendar";

describe("nextRange", () => {
  it("first click starts a range, a later click ends it, an earlier click or a third click starts again", () => {
    expect(nextRange(null, "2026-11-10")).toEqual({ start: "2026-11-10", end: "2026-11-10", anchor: "2026-11-10" });
    expect(nextRange("2026-11-10", "2026-11-13")).toEqual({ start: "2026-11-10", end: "2026-11-13", anchor: null });
    expect(nextRange(null, "2026-11-20")).toEqual({ start: "2026-11-20", end: "2026-11-20", anchor: "2026-11-20" });
    expect(nextRange("2026-11-10", "2026-11-03")).toEqual({ start: "2026-11-03", end: "2026-11-03", anchor: "2026-11-03" });
    expect(nextRange("2026-11-10", "2026-11-10")).toEqual({ start: "2026-11-10", end: "2026-11-10", anchor: null });
  });
});
