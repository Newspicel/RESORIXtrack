import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { makeAdmin, makeUser } from "@/test/factories"
import { db } from "../db"
import { apikey, notifications, revisions } from "../db/schema"
import { listAllApiKeys, revokeApiKeyAsAdmin } from "./api-keys"
import { actorFromUser } from "./permissions"

function key(userId: number, name: string, over: Partial<typeof apikey.$inferInsert> = {}) {
  const now = new Date()
  return db
    .insert(apikey)
    .values({
      name,
      key: `hash-${name}`,
      start: "rt_abc",
      referenceId: String(userId),
      permissions: JSON.stringify({ time: ["read", "write"] }),
      createdAt: now,
      updatedAt: now,
      ...over,
    })
    .returning()
    .get()
}

describe("admin API key overview", () => {
  it("lists every key with its owner, paginated and filtered, for administrators only", () => {
    const admin = actorFromUser(makeAdmin())
    const anna = makeUser({ name: "Anna" })
    const ben = makeUser({ name: "Ben" })
    for (let i = 0; i < 12; i++) key(anna.id, `k${i}`)
    key(ben.id, "old", { expiresAt: new Date(Date.now() - 1000) })
    key(ben.id, "off", { enabled: false })

    const first = listAllApiKeys(admin, { pageSize: 10 })
    expect(first.total).toBe(14)
    expect(first.items).toHaveLength(10)
    expect(listAllApiKeys(admin, { pageSize: 10, page: 2 }).items).toHaveLength(4)
    const all = listAllApiKeys(admin, { pageSize: 50 }).items
    expect(all.find((k) => k.name === "k0")).toMatchObject({
      ownerName: "Anna",
      ownerId: anna.id,
      start: "rt_abc",
      scopes: ["time:read", "time:write"],
      enabled: true,
      expired: false,
    })
    expect(all.find((k) => k.name === "old")?.expired).toBe(true)
    expect(JSON.stringify(all)).not.toContain("hash-")
    expect(listAllApiKeys(admin, { status: "active" }).total).toBe(12)

    expect(() => listAllApiKeys(actorFromUser(anna))).toThrow(/Administrators only/)
  })

  it("revokes with a reason: logged, owner notified, idempotent", () => {
    const adminUser = makeAdmin({ name: "Ada" })
    const admin = actorFromUser(adminUser)
    const anna = makeUser()
    const k = key(anna.id, "Desktop")

    expect(() => revokeApiKeyAsAdmin(actorFromUser(anna), k.id, "")).toThrow(/Administrators only/)
    revokeApiKeyAsAdmin(admin, k.id, "Laptop lost")
    revokeApiKeyAsAdmin(admin, k.id, "again")

    expect(db.select().from(apikey).where(eq(apikey.id, k.id)).get()?.enabled).toBe(false)
    const revs = db.select().from(revisions).where(eq(revisions.entity, "api_token")).all()
    expect(revs).toHaveLength(1)
    expect(revs[0]).toMatchObject({
      action: "revoke",
      actorId: adminUser.id,
      subjectUserId: anna.id,
      reason: "Laptop lost",
    })
    expect(revs[0].before).toMatchObject({ name: "Desktop", enabled: true, scopes: "time:read time:write" })
    expect(revs[0].after).toMatchObject({ enabled: false })
    const notes = db.select().from(notifications).where(eq(notifications.userId, anna.id)).all()
    expect(notes.map((n) => [n.kind, n.payload])).toEqual([
      ["token_revoked", { actor_name: "Ada", name: "Desktop", reason: "Laptop lost" }],
    ])
    expect(() => revokeApiKeyAsAdmin(admin, 999_999, "")).toThrow(/not found/)

    // an administrator's own key: no notification to themselves
    const own = key(adminUser.id, "Mine")
    revokeApiKeyAsAdmin(admin, own.id, "")
    expect(db.select().from(notifications).where(eq(notifications.userId, adminUser.id)).all()).toHaveLength(0)
  })
})
