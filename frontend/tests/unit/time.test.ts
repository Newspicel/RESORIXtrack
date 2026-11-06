// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { describe, expect, it } from "vitest";
import { addDays, addMonths, fmtDuration, fmtTime, localDate, minutesOfDay, monthEnd, toLocalInput, weekStart, weekday } from "../../src/lib/time";

describe("fmtDuration", () => {
  it("formats minutes as h:mm", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(504)).toBe("8:24");
    expect(fmtDuration(59.6)).toBe("1:00");
    expect(fmtDuration(-90)).toBe("−1:30");
    expect(fmtDuration(3000)).toBe("50:00");
  });
  it("signs balances", () => {
    expect(fmtDuration(30, { signed: true })).toBe("+0:30");
    expect(fmtDuration(-30, { signed: true })).toBe("−0:30");
    expect(fmtDuration(0, { signed: true })).toBe("±0:00");
    expect(fmtDuration(null)).toBe("–");
  });
});

describe("timezones", () => {
  it("displays UTC instants in the user's zone", () => {
    expect(fmtTime("2026-11-05T07:00:00Z", "Europe/Zurich")).toBe("08:00");
    expect(fmtTime("2026-07-05T07:00:00Z", "Europe/Zurich")).toBe("09:00"); // summer time
    expect(fmtTime("2026-11-05T07:00:00Z", "America/New_York")).toBe("02:00");
  });
  it("assigns the local calendar day", () => {
    expect(localDate("2026-11-05T23:30:00Z", "Europe/Zurich")).toBe("2026-11-06");
    expect(localDate("2026-11-05T23:30:00Z", "UTC")).toBe("2026-11-05");
    expect(minutesOfDay("2026-11-05T07:15:00Z", "Europe/Zurich")).toBe(8 * 60 + 15);
    expect(toLocalInput("2026-11-05T07:15:00Z", "Europe/Zurich")).toBe("2026-11-05T08:15");
  });
});

describe("date arithmetic", () => {
  it("handles weeks, months and leap years", () => {
    expect(weekStart("2026-11-05")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekday("2026-11-08")).toBe(6);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // across DST
  });
});
