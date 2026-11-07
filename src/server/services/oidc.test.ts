import { describe, expect, it } from "vitest"
import { makeUser } from "@/test/factories"
import { db } from "../db"
import { account } from "../db/schema"
import { oidcDecision } from "./oidc"

const link = (userId: number, sub: string) => {
  const now = new Date()
  db.insert(account).values({ userId, accountId: sub, providerId: "oidc", createdAt: now, updatedAt: now }).run()
}

describe("OIDC linking rules", () => {
  it("links an existing active person by verified email, case-insensitively", () => {
    const u = makeUser({ email: "anna@example.nomail" })
    expect(oidcDecision({ sub: "s1", email: "Anna@Example.NOMAIL", emailVerified: true })).toMatchObject({
      ok: true,
      linked: false,
      user: { id: u.id },
    })
  })

  it("never creates accounts for unknown emails", () => {
    expect(oidcDecision({ sub: "s2", email: "ghost@example.nomail", emailVerified: true })).toMatchObject({
      ok: false,
      reason: "oidc_no_account",
    })
    expect(oidcDecision({ sub: "s2", email: null, emailVerified: true })).toMatchObject({
      ok: false,
      reason: "oidc_no_account",
    })
  })

  it("rejects deactivated people, also when already linked", () => {
    const u = makeUser({ email: "old@example.nomail", isActive: false })
    expect(oidcDecision({ sub: "s3", email: u.email, emailVerified: true })).toMatchObject({
      ok: false,
      reason: "inactive",
    })
    link(u.id, "s3")
    expect(oidcDecision({ sub: "s3", email: "other@example.nomail", emailVerified: true })).toMatchObject({
      ok: false,
      reason: "inactive",
    })
  })

  it("requires a verified email for the first link unless configured otherwise", () => {
    makeUser({ email: "eva@example.nomail" })
    expect(oidcDecision({ sub: "s4", email: "eva@example.nomail", emailVerified: false })).toMatchObject({
      ok: false,
      reason: "oidc_unverified",
    })
    expect(
      oidcDecision({ sub: "s4", email: "eva@example.nomail", emailVerified: false }, { requireVerifiedEmail: false }),
    ).toMatchObject({ ok: true })
  })

  it("keeps an existing link by subject even if the provider's email changed", () => {
    const u = makeUser({ email: "max@example.nomail" })
    link(u.id, "s5")
    expect(oidcDecision({ sub: "s5", email: "max.new@example.nomail", emailVerified: false })).toMatchObject({
      ok: true,
      linked: true,
      user: { id: u.id },
    })
  })
})
