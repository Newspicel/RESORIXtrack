import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { lockMonth, makeAbsenceRow, makeEntry, makeLead, makeOrg, makeUser, withSettings } from "@/test/factories"
import { auth } from "../auth"
import { db } from "../db"
import { absenceTypes, apikey, timeEntries, users } from "../db/schema"
import { keyBuckets } from "./auth"
import { SCOPES, type Scope } from "./endpoint"
import { ENDPOINTS } from "./endpoints"
import { handleRest } from "./router"

const ALL: Scope[] = [...SCOPES]

async function keyFor(userId: number, scopes: Scope[] = ALL, expiresIn?: number): Promise<string> {
  const permissions: Record<string, string[]> = {}
  for (const s of scopes) {
    const [res, action] = s.split(":")
    permissions[res] = [...(permissions[res] ?? []), action]
  }
  const created = await auth.api.createApiKey({
    body: { userId: String(userId), name: "test", permissions, ...(expiresIn ? { expiresIn } : {}) },
  })
  return created.key
}

async function call(
  key: string | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await handleRest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: {
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
  const text = await res.text()
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null }
}

let org: ReturnType<typeof makeOrg>
beforeEach(() => {
  keyBuckets.reset()
  org = makeOrg()
})

describe("authentication", () => {
  it("rejects missing, invalid and expired keys and inactive owners with 401", async () => {
    expect((await call(null, "GET", "/me")).status).toBe(401)
    const bad = await call("rt_nope", "GET", "/me")
    expect(bad.status).toBe(401)
    expect(bad.json.error.code).toBe("unauthorized")
    expect(bad.headers.get("www-authenticate")).toContain("Bearer")
    const key = await keyFor(org.anna.id)
    db.update(apikey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run()
    expect((await call(key, "GET", "/me")).status).toBe(401)
    const key2 = await keyFor(org.ben.id)
    db.update(users).set({ isActive: false }).where(eq(users.id, org.ben.id)).run()
    expect((await call(key2, "GET", "/me")).status).toBe(401)
  })

  it("is switched off company-wide by api_tokens_enabled", async () => {
    const key = await keyFor(org.anna.id)
    withSettings({ api_tokens_enabled: false })
    const r = await call(key, "GET", "/me")
    expect(r.status).toBe(403)
    expect(r.json.error.code).toBe("api_keys_disabled")
  })

  it("never accepts a session cookie", async () => {
    const r = await call(null, "GET", "/me", undefined, { cookie: "rt.session_token=whatever" })
    expect(r.status).toBe(401)
  })

  it("records the last use and counts requests", async () => {
    const key = await keyFor(org.anna.id)
    await call(key, "GET", "/me")
    await call(key, "GET", "/me")
    const row = db.select().from(apikey).get()!
    expect(row.requestCount).toBe(2)
    expect(row.lastRequest).toBeTruthy()
  })

  it("rate-limits per key with 429 and Retry-After", async () => {
    const key = await keyFor(org.anna.id)
    const id = String(db.select().from(apikey).get()!.id)
    while (keyBuckets.take(id) === 0) {
      // drain the bucket
    }
    const r = await call(key, "GET", "/me")
    expect(r.status).toBe(429)
    expect(r.json.error.code).toBe("too_many_requests")
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0)
    const other = await keyFor(org.ben.id)
    expect((await call(other, "GET", "/me")).status).toBe(200)
  })

  it("answers unknown paths with 404 and wrong methods with 405", async () => {
    const key = await keyFor(org.anna.id)
    expect((await call(key, "GET", "/nope")).status).toBe(404)
    expect((await call(key, "PUT", "/me")).status).toBe(405)
    expect((await call(key, "GET", "/entries/abc")).status).toBe(404)
  })
})

describe("scopes", () => {
  it("every endpoint refuses keys without its scope (403 insufficient_scope)", async () => {
    await Promise.all(
      ENDPOINTS.filter((e) => e.scope).map(async (ep) => {
        const others = ALL.filter((s) => s !== ep.scope)
        const key = await keyFor(org.hr!.id, others)
        const path = ep.path.replace("{id}", "1")
        const r = await call(key, ep.method, path, ep.method === "GET" ? undefined : {})
        expect(r.status, `${ep.method} ${ep.path}`).toBe(403)
        expect(r.json.error.code).toBe("insufficient_scope")
      }),
    )
  })

  it("another person's data needs reports:read on top of the endpoint scope", async () => {
    const key = await keyFor(org.lead.id, ["time:read"])
    const r = await call(key, "GET", `/days?from=2026-11-02&to=2026-11-06&userId=${org.anna.id}`)
    expect(r.status).toBe(403)
    expect(r.json.error.fields.scope).toBe("reports:read")
    const e = makeEntry(org.anna.id, "2026-11-02T08:00:00Z", "2026-11-02T12:00:00Z")
    expect((await call(key, "GET", `/entries/${e.id}`)).status).toBe(403)
    const full = await keyFor(org.lead.id, ["time:read", "reports:read"])
    expect((await call(full, "GET", `/entries/${e.id}`)).status).toBe(200)
  })
})

describe("me and people", () => {
  it("GET /me describes the owner and the key's scopes", async () => {
    const key = await keyFor(org.lead.id, ["time:read", "reports:read"])
    const r = await call(key, "GET", "/me")
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({
      id: org.lead.id,
      name: "Lea Lead",
      isLead: true,
      isHr: false,
      scopes: ["reports:read", "time:read"],
      company: { timezone: "Europe/Zurich" },
    })
  })

  it("GET /users lists visible people for leads and HR only, paginated", async () => {
    const emp = await call(await keyFor(org.anna.id), "GET", "/users")
    expect(emp.status).toBe(403)
    const lead = await call(await keyFor(org.lead.id), "GET", "/users")
    expect(lead.json.items.map((p: { name: string }) => p.name).sort()).toEqual([
      "Anna Muster",
      "Ben Beispiel",
      "Lea Lead",
    ])
    const hrKey = await keyFor(org.hr!.id)
    const first = await call(hrKey, "GET", "/users?limit=2")
    expect(first.json.items).toHaveLength(2)
    const seen = [...first.json.items]
    let cursor = first.json.nextCursor
    while (cursor) {
      // each page needs the previous page's cursor
      // oxlint-disable-next-line eslint/no-await-in-loop
      const next = await call(hrKey, "GET", `/users?limit=2&cursor=${cursor}`)
      seen.push(...next.json.items)
      cursor = next.json.nextCursor
    }
    expect(seen).toHaveLength(6)
    expect((await call(hrKey, "GET", "/users?cursor=%%%")).status).toBe(422)
  })
})

describe("clock", () => {
  it("clocks in and out; actions are idempotent; a future out schedules the clock-out", async () => {
    const key = await keyFor(org.anna.id)
    const a = await call(key, "POST", "/clock/in")
    expect(a.status).toBe(200)
    expect(a.json).toMatchObject({ state: "working", replayed: false, scheduledEnd: null })
    expect((await call(key, "POST", "/clock/in")).json.state).toBe("working")
    const later = await call(key, "POST", "/clock/out", { at: "2026-11-05T16:00:00Z" })
    expect(later.json).toMatchObject({ state: "working", scheduledEnd: "2026-11-05T16:00:00.000Z" })
    expect((await call(key, "GET", "/clock")).json.scheduledEnd).toBe("2026-11-05T16:00:00.000Z")
    expect((await call(key, "POST", "/clock/unschedule")).json).toMatchObject({ state: "working", scheduledEnd: null })
    expect((await call(key, "POST", "/clock/out")).json.state).toBe("idle")
    expect((await call(key, "GET", "/clock")).json).toMatchObject({ state: "idle", entry: null })
    const rows = db.select().from(timeEntries).where(eq(timeEntries.userId, org.anna.id)).all()
    expect(rows.map((r) => r.source)).toEqual(["api"])
    expect((await call(key, "POST", "/clock/break")).status).toBe(404)
  })

  it("replays a clientId without changing anything and marks desktop clients", async () => {
    const key = await keyFor(org.anna.id)
    const desk = { "x-client": "desktop/2.0" }
    const first = await call(key, "POST", "/clock/in", { clientId: "c-1", at: "2026-11-05T07:30:00Z" }, desk)
    expect(first.json).toMatchObject({ state: "working", replayed: false, since: "2026-11-05T07:30:00.000Z" })
    await call(key, "POST", "/clock/out", { clientId: "c-2" }, desk)
    const again = await call(key, "POST", "/clock/in", { clientId: "c-1" }, desk)
    expect(again.json).toMatchObject({ state: "idle", replayed: true })
    const rows = db.select().from(timeEntries).where(eq(timeEntries.userId, org.anna.id)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe("desktop")
  })

  it("validates times and reports conflicts", async () => {
    const key = await keyFor(org.anna.id)
    const future = await call(key, "POST", "/clock/in", { at: "2026-11-06T08:00:00Z" })
    expect(future.status).toBe(422)
    expect(future.json.error.fields.at).toBe("future")
    await call(key, "POST", "/clock/in")
    const late = await call(key, "POST", "/clock/out", { at: "2026-11-06T09:00:00Z" })
    expect(late.status).toBe(422)
    expect(late.json.error.fields.at).toBe("too_late")
    expect((await call(key, "POST", "/clock/in", { at: 5 })).status).toBe(422)
    expect((await call(key, "POST", "/clock/in", "{")).status).toBe(422)
    const bad = await handleRest(
      new Request("http://localhost/api/v1/clock/in", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: "{not json",
      }),
    )
    expect(bad.status).toBe(400)
  })

  it("syncs offline actions once per clientId", async () => {
    const key = await keyFor(org.anna.id)
    const actions = [
      { clientId: "a", action: "in", at: "2026-11-05T06:00:00Z" },
      { clientId: "b", action: "out", at: "2026-11-05T07:00:00Z" },
    ]
    const r = await call(key, "POST", "/clock/sync", { actions })
    expect(r.json.results).toEqual([
      { clientId: "a", status: "applied" },
      { clientId: "b", status: "applied" },
    ])
    const again = await call(key, "POST", "/clock/sync", { actions })
    expect(again.json.results.map((x: { status: string }) => x.status)).toEqual(["duplicate", "duplicate"])
    expect((await call(key, "POST", "/clock/sync", { actions: [] })).status).toBe(422)
  })
})

describe("entries and days", () => {
  it("creates, lists (paginated), reads, changes and deletes own entries", async () => {
    const key = await keyFor(org.anna.id)
    const c = await call(key, "POST", "/entries", { startAt: "2026-11-05T06:00:00Z", endAt: "2026-11-05T07:00:00Z" })
    expect(c.status).toBe(201)
    expect(c.json).toMatchObject({ kind: "work", source: "api", minutes: 60, startAt: "2026-11-05T06:00:00.000Z" })
    expect(c.json).not.toHaveProperty("createdById")
    await call(key, "POST", "/entries", {
      startAt: "2026-11-04T06:00:00Z",
      endAt: "2026-11-04T07:00:00Z",
      reason: "forgot",
    })
    const p1 = await call(key, "GET", "/entries?from=2026-11-01&to=2026-11-30&limit=1")
    expect(p1.json.items[0].startAt).toBe("2026-11-04T06:00:00.000Z")
    const p2 = await call(key, "GET", `/entries?from=2026-11-01&to=2026-11-30&limit=1&cursor=${p1.json.nextCursor}`)
    expect(p2.json.items[0].id).toBe(c.json.id)
    expect(p2.json.nextCursor).toBeNull()
    expect((await call(key, "GET", `/entries/${c.json.id}`)).json.id).toBe(c.json.id)
    const u = await call(key, "PATCH", `/entries/${c.json.id}`, { note: "standup" })
    expect(u.json.note).toBe("standup")
    expect((await call(key, "DELETE", `/entries/${c.json.id}`)).status).toBe(204)
    const list = await call(key, "GET", "/entries?from=2026-11-05&to=2026-11-05&includeDeleted=true")
    expect(list.json.items[0].deleted).toBe(true)
  })

  it("never writes other people's entries, even a lead's key for a member", async () => {
    const e = makeEntry(org.anna.id, "2026-11-02T08:00:00Z", "2026-11-02T12:00:00Z")
    const key = await keyFor(org.lead.id)
    expect((await call(key, "PATCH", `/entries/${e.id}`, { note: "x", reason: "x" })).status).toBe(404)
    expect((await call(key, "DELETE", `/entries/${e.id}`, { reason: "x" })).status).toBe(404)
    const carl = await keyFor(org.carl.id)
    expect((await call(carl, "GET", `/entries/${e.id}`)).status).toBe(404)
  })

  it("validates input with field errors and refuses signed-off months", async () => {
    const key = await keyFor(org.anna.id)
    const v = await call(key, "POST", "/entries", { startAt: "x" })
    expect(v.status).toBe(422)
    expect(v.json.error).toMatchObject({ code: "validation_error", fields: { endAt: expect.any(String) } })
    lockMonth(org.anna.id, "2026-10")
    const locked = await call(key, "POST", "/entries", {
      startAt: "2026-10-05T06:00:00Z",
      endAt: "2026-10-05T07:00:00Z",
      reason: "late",
    })
    expect(locked.status).toBe(409)
    expect(locked.json.error.code).toBe("period_signed_off")
  })

  it("GET /days returns per-day figures and a summary; leads read members with reports:read", async () => {
    makeEntry(org.anna.id, "2026-11-02T07:00:00Z", "2026-11-02T15:24:00Z")
    const own = await call(await keyFor(org.anna.id), "GET", "/days?from=2026-11-02&to=2026-11-06")
    expect(own.json.days).toHaveLength(5)
    expect(own.json.days[0]).toMatchObject({ date: "2026-11-02", workedMin: 504, targetMin: 504 })
    expect(own.json.summary.workdays).toBe(5)
    // frozen at Thu 2026-11-05 09:00 Zurich: today is in progress and not part of target/delta
    expect(own.json.days.map((d: { isToday: boolean }) => d.isToday)).toEqual([false, false, false, true, false])
    expect(own.json.summary).toMatchObject({
      targetMin: 3 * 504,
      workedCompleteMin: 504,
      deltaMin: 504 - 3 * 504,
      todayTargetMin: 504,
      todayWorkedMin: 0,
      targetTotalMin: 5 * 504,
    })
    const lead = await keyFor(org.lead.id)
    expect((await call(lead, "GET", `/days?from=2026-11-02&to=2026-11-02&userId=${org.anna.id}`)).status).toBe(200)
    expect((await call(lead, "GET", `/days?from=2026-11-02&to=2026-11-02&userId=${org.carl.id}`)).status).toBe(404)
    expect((await call(lead, "GET", "/days?from=2026-11-02&to=2028-11-02")).status).toBe(422)
    expect((await call(lead, "GET", "/days?from=2026-11-05&to=2026-11-02")).status).toBe(422)
  })

  it("administrators without HR never read time data of others", async () => {
    const key = await keyFor(org.admin.id)
    expect((await call(key, "GET", `/days?from=2026-11-02&to=2026-11-02&userId=${org.anna.id}`)).status).toBe(404)
    expect((await call(key, "GET", `/balance?userId=${org.anna.id}`)).status).toBe(404)
    expect((await call(key, "GET", "/users")).status).toBe(403)
  })
})

describe("absences and accounts", () => {
  it("lists types, requests, reads and cancels own absences", async () => {
    const key = await keyFor(org.anna.id)
    const types = await call(key, "GET", "/absence-types")
    expect(types.json.items.find((t: { key: string }) => t.key === "vacation")).toMatchObject({ requestable: true })
    const c = await call(key, "POST", "/absences", { type: "vacation", startDate: "2026-12-14", endDate: "2026-12-15" })
    expect(c.status).toBe(201)
    expect(c.json).toMatchObject({ status: "pending", days: 2, type: { key: "vacation" }, user: { id: org.anna.id } })
    expect(c.json).not.toHaveProperty("permissions")
    const list = await call(key, "GET", "/absences?from=2026-12-01&to=2026-12-31&status=pending")
    expect(list.json.items.map((a: { id: number }) => a.id)).toEqual([c.json.id])
    expect((await call(key, "GET", "/absences?from=2026-12-01&to=2026-12-31&status=bogus")).status).toBe(422)
    expect((await call(key, "GET", `/absences/${c.json.id}`)).json.id).toBe(c.json.id)
    const x = await call(key, "POST", `/absences/${c.json.id}/cancel`, { reason: "plans changed" })
    expect(x.json.status).toBe("cancelled")
  })

  it("never cancels other people's absences and hides foreign ones", async () => {
    const sick = db.select().from(absenceTypes).where(eq(absenceTypes.key, "sick")).get()!
    const a = makeAbsenceRow(org.anna.id, sick.id, "2026-11-03")
    const lead = await keyFor(org.lead.id)
    expect((await call(lead, "POST", `/absences/${a.id}/cancel`, {})).status).toBe(404)
    expect((await call(lead, "GET", `/absences/${a.id}`)).status).toBe(200)
    const ben = await keyFor(org.ben.id)
    expect((await call(ben, "GET", `/absences/${a.id}`)).status).toBe(404)
    expect((await call(ben, "GET", `/absences?from=2026-11-01&to=2026-11-30&userId=${org.anna.id}`)).status).toBe(404)
  })

  it("GET /holidays: the caller's calendar only", async () => {
    const key = await keyFor(org.anna.id)
    const h = await call(key, "GET", "/holidays?year=2026")
    expect(h.status).toBe(200)
    expect(h.json).toMatchObject({ source: "default", firstYear: 2026, lastYear: 2026 })
    expect(h.json.holidays.map((d: { date: string }) => d.date)).toEqual(["2026-12-08", "2026-12-25"])
    expect((await call(key, "GET", "/holidays?year=2027")).json.holidays).toEqual([])
  })

  it("GET /balance and /vacation", async () => {
    const key = await keyFor(org.anna.id)
    const b = await call(key, "GET", "/balance")
    expect(b.json).toMatchObject({ userId: org.anna.id, asOf: "2026-11-04" })
    const v = await call(key, "GET", "/vacation?year=2026")
    expect(v.json).toMatchObject({ userId: org.anna.id, year: 2026, entitlement: 25 })
    expect((await call(key, "GET", "/vacation?year=abc")).status).toBe(422)
  })
})

describe("reports", () => {
  it("GET /reports/timesheet for oneself and for a led member", async () => {
    makeEntry(org.anna.id, "2026-11-02T07:00:00Z", "2026-11-02T15:00:00Z", { note: "release" })
    const own = await call(await keyFor(org.anna.id), "GET", "/reports/timesheet?month=2026-11")
    expect(own.status).toBe(200)
    expect(own.json).toMatchObject({ year: 2026, month: 11, user: { id: org.anna.id } })
    expect(own.json.entries["2026-11-02"][0]).toMatchObject({ start: "08:00", note: "release" })
    const lead = await keyFor(org.lead.id)
    expect((await call(lead, "GET", `/reports/timesheet?month=2026-11&userId=${org.anna.id}`)).status).toBe(200)
    expect((await call(lead, "GET", `/reports/timesheet?month=2026-11&userId=${org.carl.id}`)).status).toBe(404)
    expect((await call(lead, "GET", "/reports/timesheet?month=2026-13")).status).toBe(422)
  })

  it("a deputy outside the validity period sees nothing of the team", async () => {
    const dep = makeUser({ name: "Dora Deputy" })
    makeLead(org.teamB.id, dep.id, { role: "deputy", validFrom: "2025-01-01", validTo: "2025-12-31" })
    const key = await keyFor(dep.id)
    expect((await call(key, "GET", `/reports/timesheet?month=2026-11&userId=${org.carl.id}`)).status).toBe(404)
    expect((await call(key, "GET", "/users")).status).toBe(403)
  })
})
