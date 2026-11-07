import { describe, expect, it } from "vitest"
import { safeNext } from "./lib"

describe("safeNext", () => {
  it("keeps a same-origin path with query and hash", () => {
    expect(safeNext("/time?view=month#x")).toBe("/time?view=month#x")
  })

  it.each([
    null,
    undefined,
    "",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "/\t/evil.com",
    "javascript:alert(1)",
  ])("sends %j home", (raw) => {
    expect(safeNext(raw)).toBe("/")
  })
})
