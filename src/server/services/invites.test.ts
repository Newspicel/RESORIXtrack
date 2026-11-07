import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { loadActor, makeAdmin, makeUser } from "@/test/factories"
import { db } from "../db"
import { authTokens, users } from "../db/schema"
import { freeze } from "../time"
import { acceptInvite, inviteInfo, sendInvite } from "./invites"
import { clearMailOutbox, mailOutbox } from "./mail"
import { hasPassword } from "./user-auth"

const tokenOf = (url: string) => url.split("#token=")[1]

beforeEach(() => clearMailOutbox())

describe("invitations", () => {
  it("only administrators invite; the mail carries a fragment link valid 7 days", () => {
    const admin = makeAdmin({ name: "Ada Admin" })
    const emp = makeUser()
    expect(() => sendInvite(loadActor(emp.id), emp.id)).toThrow(/administrators/)
    freeze("2026-11-06T10:00:00Z")
    const { url, expiresAt } = sendInvite(loadActor(admin.id), emp.id)
    expect(url).toMatch(/\/invite#token=[\w-]{40,}$/)
    expect(expiresAt).toBe("2026-11-13T10:00:00.000Z")
    expect(mailOutbox()).toHaveLength(1)
    expect(mailOutbox()[0]).toMatchObject({ kind: "invite", to: emp.email })
    expect(mailOutbox()[0].text).toContain("Ada Admin")
    // stored hashed, never in plain text
    const row = db.select().from(authTokens).where(eq(authTokens.userId, emp.id)).get()
    expect(row?.tokenHash).not.toBe(tokenOf(url))
    expect(inviteInfo(tokenOf(url))).toMatchObject({ email: emp.email })
  })

  it("accepts once: sets the password, locale and timezone", async () => {
    const admin = makeAdmin()
    const emp = makeUser({ email: "eva@example.nomail" })
    const { url } = sendInvite(loadActor(admin.id), emp.id)
    const user = await acceptInvite(tokenOf(url), {
      password: "a long passphrase",
      locale: "de",
      timezone: "Europe/Berlin",
    })
    expect(user).toMatchObject({ locale: "de", timezone: "Europe/Berlin", emailVerified: true })
    expect(hasPassword(emp.id)).toBe(true)
    await expect(acceptInvite(tokenOf(url), { password: "another passphrase" })).rejects.toMatchObject({
      code: "invalid_token",
    })
  })

  it("rejects expired, superseded and deactivated links and weak passwords", async () => {
    const admin = makeAdmin()
    const emp = makeUser({ email: "otto@example.nomail" })
    freeze("2026-11-01T08:00:00Z")
    const first = sendInvite(loadActor(admin.id), emp.id)
    const second = sendInvite(loadActor(admin.id), emp.id)
    expect(() => inviteInfo(tokenOf(first.url))).toThrow(/invalid or has expired/)
    await expect(acceptInvite(tokenOf(second.url), { password: "otto-password-1" })).rejects.toMatchObject({
      code: "password_contains_email",
    })
    freeze("2026-11-08T08:00:01Z")
    await expect(acceptInvite(tokenOf(second.url), { password: "a long passphrase" })).rejects.toMatchObject({
      code: "invalid_token",
    })
    freeze("2026-11-02T08:00:00Z")
    db.update(users).set({ isActive: false }).where(eq(users.id, emp.id)).run()
    expect(() => inviteInfo(tokenOf(second.url))).toThrow()
    expect(() => sendInvite(loadActor(admin.id), emp.id)).toThrow(/deactivated/)
    expect(hasPassword(emp.id)).toBe(false)
  })
})
