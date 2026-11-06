import { describe, expect, it } from "vitest";
import { fmtHourLabel, fmtTimeOfDay, parseTimeInput, setHour12 } from "../../src/lib/time";

describe("parseTimeInput", () => {
  it("accepts the usual ways of typing a time", () => {
    for (const [input, out] of [["9", "09:00"], ["09:30", "09:30"], ["9:30", "09:30"], ["930", "09:30"], ["0930", "09:30"], ["1330", "13:30"],
      ["9.30", "09:30"], ["9:30 pm", "21:30"], ["9:30PM", "21:30"], ["12 am", "00:00"], ["12:15 pm", "12:15"], ["23:59", "23:59"], [" 7 ", "07:00"]] as const) {
      expect(parseTimeInput(input), input).toBe(out);
    }
  });
  it("rejects nonsense", () => {
    for (const input of ["", "24:00", "9:60", "13 pm", "0 am", "abc", "9:3", "1:2:3"]) expect(parseTimeInput(input), input).toBeNull();
  });
});

describe("fmtTimeOfDay / fmtHourLabel", () => {
  it("follows the profile setting", () => {
    setHour12(false);
    expect(fmtTimeOfDay("13:05")).toBe("13:05");
    expect(fmtTimeOfDay("00:00")).toBe("00:00");
    expect(fmtHourLabel(6)).toBe("06:00");
    setHour12(true);
    expect(fmtTimeOfDay("13:05")).toBe("1:05 PM");
    expect(fmtTimeOfDay("00:00")).toBe("12:00 AM");
    expect(fmtTimeOfDay("12:30")).toBe("12:30 PM");
    expect(fmtHourLabel(6)).toBe("6 AM");
    expect(fmtHourLabel(0)).toBe("12 AM");
    setHour12(false);
  });
});
