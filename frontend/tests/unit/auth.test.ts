// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { describe, expect, it } from "vitest";
import { safeNext } from "../../src/views/auth";

describe("safeNext (post-login redirect)", () => {
  const origin = "https://time.example.com";
  it("keeps same-origin paths", () => {
    expect(safeNext("/time?view=month#x", origin)).toBe("/time?view=month#x");
    expect(safeNext("/", origin)).toBe("/");
  });
  it("rejects anything that leaves the origin", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com/", "javascript:alert(1)", "http://time.example.com.evil.com/"]) {
      expect(safeNext(bad, origin)).toBe("/");
    }
  });
  it("falls back to / when empty", () => {
    expect(safeNext(null, origin)).toBe("/");
    expect(safeNext("", origin)).toBe("/");
  });
});
