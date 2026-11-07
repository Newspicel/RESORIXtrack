import { describe, expect, it } from "vitest"
import { db, rawSqlite } from "@/server/db"
import * as s from "@/server/db/schema"
import fixture from "./__fixtures__/seals-v1.json"
import {
  canonical,
  checkUserChain,
  computeDigest,
  computeSeal,
  jcs,
  PyFloat,
  periodDataOf,
  pyDumps,
  pyFloatRepr,
  sealKey,
  sealMessage,
} from "./seals"

const key = sealKey(fixture.key)

function loadFixture() {
  db.insert(s.users)
    .values([
      { id: 3, email: "lead@example.nomail", name: "Lea Lead" },
      { id: fixture.userId, email: "zoe@example.nomail", name: "Zoë" },
    ])
    .run()
  db.insert(s.absenceTypes)
    .values([
      { id: 1, key: "vacation", label: "Vacation" },
      { id: 2, key: "sick", label: "Sick" },
    ])
    .run()
  db.insert(s.projects).values({ id: 5, name: "Planung" }).run()
  const userId = fixture.userId
  for (const e of fixture.entries)
    db.insert(s.timeEntries)
      .values({ ...e, userId, kind: e.kind as "work" })
      .run()
  for (const a of fixture.absences)
    db.insert(s.absences)
      .values({
        ...a,
        userId,
        startHalf: a.startHalf as "full",
        endHalf: a.endHalf as "full",
        status: a.status as "approved",
      })
      .run()
  for (const a of fixture.adjustments)
    db.insert(s.balanceAdjustments)
      .values({ ...a, userId, account: a.account as "time", reason: "x" })
      .run()
  for (const w of fixture.workLogs)
    db.insert(s.workLogs)
      .values({ ...w, userId })
      .run()
  for (const r of fixture.signoffs) {
    db.insert(s.monthSignoffs)
      .values({
        id: r.id,
        userId,
        month: r.month,
        periodStartDate: r.periodStartDate,
        periodEndDate: r.periodEndDate,
        periodStartUtc: r.periodStartUtc,
        periodEndUtc: r.periodEndUtc,
        signedById: r.signedById,
        signedAt: r.signedAt,
        snapshot: r.snapshot,
        digest: r.digest,
        prevSeal: r.prevSeal,
        seal: r.seal,
        sealVersion: 1,
        reopenedAt: r.reopenedAt,
      })
      .run()
  }
  return db.select().from(s.monthSignoffs).orderBy(s.monthSignoffs.id).all()
}

function dropGuards() {
  const names = rawSqlite().prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]
  for (const { name } of names) rawSqlite().exec(`DROP TRIGGER ${name}`)
}

describe("python json.dumps port", () => {
  it("formats floats like Python repr", () => {
    const cases: [number, string][] = [
      [1, "1.0"],
      [0.5, "0.5"],
      [-30, "-30.0"],
      [0, "0.0"],
      [-0, "-0.0"],
      [0.1 + 0.2, "0.30000000000000004"],
      [1e-5, "1e-05"],
      [0.0001, "0.0001"],
      [1e16, "1e+16"],
      [1e15, "1000000000000000.0"],
      [123456.789, "123456.789"],
      [1.5e300, "1.5e+300"],
      [-2.5e-7, "-2.5e-07"],
      [1.2345678901234567e19, "1.2345678901234567e+19"],
      [Number.NaN, "NaN"],
    ]
    for (const [x, want] of cases) expect(pyFloatRepr(x)).toBe(want)
  })

  it("escapes strings like ensure_ascii and sorts keys", () => {
    expect(pyDumps({ b: "Zürich – 😀", a: [1, new PyFloat(2), null, true, 'q"\\\n\u007f\u0001'] })).toBe(
      '{"a":[1,2.0,null,true,"q\\"\\\\\\n\\u007f\\u0001"],"b":"Z\\u00fcrich \\u2013 \\ud83d\\ude00"}',
    )
  })
})

describe("RFC 8785", () => {
  it("serialises numbers per ECMAScript and sorts keys by UTF-16 code units", () => {
    expect(jcs([1e21, 0.000001, 1e-7, -0, new PyFloat(30), 4.5])).toBe("[1e+21,0.000001,1e-7,0,30,4.5]")
    const obj = { "€": "Euro", "\r": "cr", דּ: "Hebrew", "1": "one", "😀": "smiley", "\u0080": "ctl", ö: "o" }
    expect(jcs(obj)).toBe(
      '{"\\r":"cr","1":"one","\u0080":"ctl","\u00f6":"o","\u20ac":"Euro","\ud83d\ude00":"smiley","\ufb33":"Hebrew"}',
    )
    expect(jcs({ b: [true, null], a: "x " })).toBe('{"a":"x ","b":[true,null]}')
  })
})

describe("v1 seals (fixtures from Python)", () => {
  it("reproduces period data, digests and seals byte for byte", () => {
    const rows = loadFixture()
    rows.forEach((row, i) => {
      const f = fixture.signoffs[i]
      const data = periodDataOf(row)
      expect(canonical(1, data as never)).toBe(f.canonicalData)
      expect(computeDigest(1, data)).toBe(f.digest)
      expect(sealMessage(row)).toBe(f.canonicalSeal)
      expect(computeSeal(row, key)).toBe(f.seal)
    })
    expect([...checkUserChain(fixture.userId, key).values()]).toEqual(["ok", "ok", "ok"])
  })

  it("detects edited data, forged snapshots and removed sign-offs", () => {
    loadFixture()
    dropGuards()
    rawSqlite().prepare("UPDATE time_entries SET end_at = '2026-10-14T11:00:00.000001Z' WHERE id = 12").run()
    expect(checkUserChain(fixture.userId, key).get(103)).toBe("digest_mismatch")
    // the reopened month is not fingerprinted any more, only sealed
    rawSqlite().prepare("UPDATE time_entries SET note = 'x' WHERE id = 15").run()
    expect(checkUserChain(fixture.userId, key).get(101)).toBe("ok")
    expect(checkUserChain(fixture.userId, key).get(102)).toBe("digest_mismatch")
    rawSqlite().prepare(`UPDATE month_signoffs SET snapshot = '{"worked_min": 99999}' WHERE id = 101`).run()
    expect(checkUserChain(fixture.userId, key).get(101)).toBe("seal_mismatch")
    rawSqlite().prepare("DELETE FROM month_signoffs WHERE id = 102").run()
    expect(checkUserChain(fixture.userId, key).get(103)).toBe("chain_broken")
  })

  it("fails with another key", () => {
    loadFixture()
    expect(checkUserChain(fixture.userId, sealKey("another-key")).get(101)).toBe("seal_mismatch")
  })
})

describe("v2 seals", () => {
  it("chains a v2 seal onto a v1 seal", () => {
    const rows = loadFixture()
    const last = rows.at(-1)!
    const data = periodDataOf({
      ...last,
      periodStartDate: "2026-11-01",
      periodEndDate: "2026-11-30",
      periodStartUtc: "2026-10-31T23:00:00Z",
      periodEndUtc: "2026-11-30T23:00:00Z",
    })
    const row = {
      userId: fixture.userId,
      month: "2026-11",
      periodStartDate: "2026-11-01",
      periodEndDate: "2026-11-30",
      periodStartUtc: "2026-10-31T23:00:00.000000Z",
      periodEndUtc: "2026-11-30T23:00:00.000000Z",
      signedById: 3,
      signedAt: "2026-12-01T08:00:00.000000Z",
      snapshot: jcs({ worked_min: 1.5, user_name: "Zoë" }),
      digest: computeDigest(2, data),
      prevSeal: last.seal,
      sealVersion: 2,
    }
    expect(sealMessage(row)).toContain('"v":2')
    expect(sealMessage(row)).toContain('"user_name":"Zoë"')
    db.insert(s.monthSignoffs)
      .values({ ...row, seal: computeSeal(row, key) })
      .run()
    expect([...checkUserChain(fixture.userId, key).values()]).toEqual(["ok", "ok", "ok", "ok"])
    expect(computeSeal({ ...row, sealVersion: 1 }, key)).not.toBe(computeSeal(row, key))
  })
})
