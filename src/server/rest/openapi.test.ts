import { describe, expect, it } from "vitest"
import { ENDPOINTS } from "./endpoints"
import { openApiDocument } from "./openapi"
import { TokenBuckets } from "./rate-limit"

type Json = Record<string, unknown>

function refs(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) refs(x, out)
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if (k === "$ref" && typeof x === "string") out.push(x)
      else refs(x, out)
    }
  return out
}

describe("OpenAPI document", () => {
  const doc = openApiDocument("https://time.example.nomail") as Json & {
    paths: Record<string, Record<string, Json>>
    components: { schemas: Record<string, Json> }
  }

  it("lists every endpoint with its scope, parameters and responses", () => {
    expect(doc.openapi).toBe("3.1.0")
    expect(doc.servers).toEqual([{ url: "https://time.example.nomail/api/v1" }])
    for (const ep of ENDPOINTS) {
      const op = doc.paths[ep.path]?.[ep.method.toLowerCase()]
      expect(op, `${ep.method} ${ep.path}`).toBeTruthy()
      expect(op["x-scope"]).toBe(ep.scope)
      expect(Object.keys(op.responses as Json)).toContain(String(ep.status))
    }
    const entries = doc.paths["/entries"].get as { parameters: { name: string; required: boolean }[] }
    expect(entries.parameters.map((p) => p.name)).toEqual(["from", "to", "userId", "includeDeleted", "limit", "cursor"])
    expect(entries.parameters.find((p) => p.name === "from")?.required).toBe(true)
    expect(doc.paths["/entries/{id}"].patch.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
    ])
  })

  it("resolves every $ref to a component and keeps operation ids unique", () => {
    for (const r of refs(doc)) {
      expect(r.startsWith("#/components/schemas/"), r).toBe(true)
      expect(doc.components.schemas[r.slice("#/components/schemas/".length)], r).toBeTruthy()
    }
    for (const name of ["Entry", "Day", "Absence", "ClockState", "Error", "Timesheet"])
      expect(doc.components.schemas[name], name).toBeTruthy()
    const ids = Object.values(doc.paths).flatMap((p) => Object.values(p).map((op) => op.operationId))
    expect(new Set(ids).size).toBe(ids.length)
    expect(JSON.stringify(doc)).not.toContain("$defs")
  })
})

describe("token buckets", () => {
  it("allows a burst, then refills over time", () => {
    let now = 0
    const b = new TokenBuckets(3, 1, () => now)
    expect([b.take("k"), b.take("k"), b.take("k")]).toEqual([0, 0, 0])
    expect(b.take("k")).toBe(1)
    expect(b.take("other")).toBe(0)
    now = 1000
    expect(b.take("k")).toBe(0)
    expect(b.take("k")).toBeGreaterThan(0)
  })
})
