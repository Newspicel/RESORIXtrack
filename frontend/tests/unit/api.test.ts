// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { describe, expect, it } from "vitest";
import { qs } from "../../src/lib/api";

describe("qs", () => {
  it("skips empty values and encodes", () => {
    expect(qs({ a: 1, b: undefined, c: null, d: "", e: "x y", f: false })).toBe("?a=1&e=x+y&f=false");
    expect(qs({})).toBe("");
  });
});
