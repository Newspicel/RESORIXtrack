import { describe, expect, it } from "vitest"
import { z } from "zod"
import { toAppError } from "./errors"

describe("toAppError", () => {
  it("turns zod validation errors into a 422 with field codes", () => {
    const r = z
      .object({ date: z.iso.date(), to: z.string().refine(() => false, "before_start") })
      .safeParse({ date: "x", to: "y" })
    const e = toAppError(r.error)
    expect(e.status).toBe(422)
    expect(e.fields).toEqual({ date: "invalid", to: "before_start" })
  })
  it("hides unknown errors", () => {
    expect(toAppError(new Error("db path /secret")).toJSON()).toEqual({
      code: "server_error",
      message: "Internal server error",
    })
  })
})
