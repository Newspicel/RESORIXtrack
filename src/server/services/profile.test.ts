import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { loadActor, makeAdmin, makeUser, withSettings } from "@/test/factories"
import { db } from "../db"
import { account, passkey, users } from "../db/schema"
import { mfaEnrolmentDue, mfaRequiredFor, mfaSatisfied } from "./mfa-policy"
import { deletePasskey, listPasskeys, renamePasskey, securityState } from "./profile"

function addPasskey(userId: number, name = "Laptop") {
  return db
    .insert(passkey)
    .values({
      userId,
      name,
      publicKey: "pk",
      credentialID: `cred-${userId}-${name}`,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
      createdAt: new Date(),
    })
    .returning()
    .get()
}

describe("MFA enforcement flags", () => {
  it("applies to admins or everyone per setting, and is satisfied by TOTP, a passkey or single sign-on", () => {
    const admin = makeAdmin()
    const emp = makeUser()
    expect(mfaEnrolmentDue(admin)).toBe(false)
    withSettings({ mfa_required_for_admins: true })
    expect(mfaEnrolmentDue(admin)).toBe(true)
    expect(mfaEnrolmentDue(emp)).toBe(false)
    withSettings({ mfa_required_for_all: true })
    expect(mfaEnrolmentDue(emp)).toBe(true)
    expect(mfaRequiredFor(emp)).toBe(true)

    expect(mfaEnrolmentDue({ ...emp, twoFactorEnabled: true })).toBe(false)
    addPasskey(emp.id)
    expect(mfaSatisfied(emp)).toBe(true)
    expect(mfaRequiredFor(emp)).toBe(false)
    const now = new Date()
    db.insert(account)
      .values({ userId: admin.id, accountId: "sub", providerId: "oidc", createdAt: now, updatedAt: now })
      .run()
    expect(mfaEnrolmentDue(admin)).toBe(false)
  })

  it("asks people imported from v1 with two-factor to enrol again", () => {
    const u = makeUser({ mfaReenrolRequired: true })
    expect(securityState(loadActor(u.id))).toMatchObject({
      mfaDue: true,
      reenrolRequired: true,
      twoFactorEnabled: false,
    })
    db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, u.id)).run()
    expect(securityState(loadActor(u.id)).mfaDue).toBe(false)
  })
})

describe("passkeys", () => {
  it("lists, renames and deletes only the actor's own passkeys", () => {
    const anna = makeUser()
    const bert = makeUser()
    const mine = addPasskey(anna.id)
    const theirs = addPasskey(bert.id)
    expect(listPasskeys(loadActor(anna.id))).toEqual([
      expect.objectContaining({ id: mine.id, name: "Laptop", provider: "iCloud Keychain", synced: true }),
    ])
    expect(() => renamePasskey(loadActor(anna.id), theirs.id, "mine now")).toThrow(/not found/)
    expect(() => deletePasskey(loadActor(anna.id), theirs.id)).toThrow(/not found/)
    renamePasskey(loadActor(anna.id), mine.id, "  Phone ")
    expect(listPasskeys(loadActor(anna.id))[0].name).toBe("Phone")
    deletePasskey(loadActor(anna.id), mine.id)
    expect(listPasskeys(loadActor(anna.id))).toEqual([])
    expect(listPasskeys(loadActor(bert.id))).toHaveLength(1)
  })
})
