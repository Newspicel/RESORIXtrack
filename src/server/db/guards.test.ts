import { describe, expect, it } from "vitest"
import { rawSqlite } from "@/server/db"
import { makeEntry, makeUser } from "@/test/factories"

describe("database guards", () => {
  it("blocks writes into an active signed-off month and keeps revisions append-only", () => {
    const u = makeUser()
    const e = makeEntry(u.id, "2026-03-10T07:00:00.000000Z", "2026-03-10T16:00:00.000000Z")
    rawSqlite()
      .prepare(
        `INSERT INTO month_signoffs (user_id, month, period_start_date, period_end_date, period_start_utc, period_end_utc, digest, seal)
         VALUES (?, '2026-03', '2026-03-01', '2026-03-31', '2026-02-28T23:00:00.000000Z', '2026-03-31T22:00:00.000000Z', 'd', 's')`,
      )
      .run(u.id)
    expect(() => rawSqlite().prepare("UPDATE time_entries SET note = 'x' WHERE id = ?").run(e.id)).toThrow(
      /period signed off/,
    )
    expect(() => rawSqlite().prepare("DELETE FROM month_signoffs").run()).toThrow(/immutable/)
    rawSqlite().prepare("INSERT INTO revisions (entity, entity_id, action) VALUES ('x', 1, 'create')").run()
    expect(() => rawSqlite().prepare("DELETE FROM revisions").run()).toThrow(/append-only/)
  })
})
