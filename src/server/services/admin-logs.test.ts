import { describe, expect, it } from "vitest"
import { makeAdmin, makeUser } from "@/test/factories"
import { db } from "../db"
import { loginAttempts, revisions } from "../db/schema"
import { auditLog, loginLog } from "./admin-logs"
import { actorFromUser } from "./permissions"

const SAME_INSTANT = "2026-10-01T08:00:00.000000Z"

/** `n` user changes; every third shares one instant, so the cursor has to break ties by id. */
function seedRevisions(subjectId: number, n: number) {
  db.insert(revisions)
    .values(
      Array.from({ length: n }, (_, i) => ({
        entity: "user",
        entityId: subjectId,
        subjectUserId: subjectId,
        action: "update",
        at:
          i % 3 === 0
            ? SAME_INSTANT
            : `2026-10-${String(2 + (i % 27)).padStart(2, "0")}T09:${String(i % 60).padStart(2, "0")}:00.000000Z`,
      })),
    )
    .run()
}

describe("audit log pages", () => {
  it("walks every row exactly once, newest first, from cursor to cursor", () => {
    const admin = actorFromUser(makeAdmin())
    const anna = makeUser({ name: "Anna" })
    seedRevisions(anna.id, 250)

    const first = auditLog(admin, { userId: anna.id, limit: 100 })
    expect(first.total).toBe(250)
    expect(first.items).toHaveLength(100)
    expect(first.nextCursor).toMatch(/~\d+$/)

    const seen = [...first.items]
    let cursor = first.nextCursor
    while (cursor) {
      const page = auditLog(admin, { userId: anna.id, limit: 100, cursor })
      // the size is counted on the first page only
      expect(page.total).toBeNull()
      seen.push(...page.items)
      cursor = page.nextCursor
    }
    expect(seen).toHaveLength(250)
    expect(new Set(seen.map((r) => r.id)).size).toBe(250)
    const keys = seen.map((r) => `${r.at}~${String(r.id).padStart(6, "0")}`)
    expect(keys).toEqual([...keys].sort().toReversed())
  })

  it("starts from the newest row when the cursor is unreadable, and needs an administrator", () => {
    const admin = actorFromUser(makeAdmin())
    const anna = makeUser({ name: "Anna" })
    seedRevisions(anna.id, 12)
    const page = auditLog(admin, { userId: anna.id, cursor: "nonsense" })
    expect(page.items).toHaveLength(12)
    expect(page.nextCursor).toBeNull()
    expect(() => auditLog(actorFromUser(anna), {})).toThrow()
  })
})

describe("sign-in log pages", () => {
  it("continues from the cursor and keeps the filters", () => {
    const admin = actorFromUser(makeAdmin())
    db.insert(loginAttempts)
      .values(
        Array.from({ length: 30 }, (_, i) => ({
          email: i % 2 ? "anna@example.nomail" : "ben@example.nomail",
          success: i % 5 !== 0,
          reason: i % 5 ? "ok" : "invalid_password",
          at: `2026-10-0${1 + (i % 9)}T10:00:00.000000Z`,
        })),
      )
      .run()
    const first = loginLog(admin, { q: "anna", limit: 10 })
    expect(first.total).toBe(15)
    expect(first.failed24h).not.toBeNull()
    const second = loginLog(admin, { q: "anna", limit: 10, cursor: first.nextCursor })
    expect(second.items).toHaveLength(5)
    expect(second.nextCursor).toBeNull()
    expect(second.failed24h).toBeNull()
    const ids = [...first.items, ...second.items].map((r) => r.id)
    expect(new Set(ids).size).toBe(15)
    expect([...first.items, ...second.items].every((r) => r.email === "anna@example.nomail")).toBe(true)
  })
})
