import { describe, expect, it } from "vitest"
import { makeAbsenceType, makeEntry, makeSchedule, makeUser } from "@/test/factories"
import { db } from "../db"
import { absences, account, apikey, loginAttempts, notifications, passkey, session, twoFactor } from "../db/schema"
import { exportPersonalData } from "./privacy"

function fill(userId: number, tag: string) {
  makeSchedule(userId)
  makeEntry(userId, "2026-11-02T07:00:00.000000Z", "2026-11-02T11:00:00.000000Z", { note: `note-${tag}` })
  const type = makeAbsenceType()
  db.insert(absences)
    .values({ userId, typeId: type.id, startDate: "2026-11-10", endDate: "2026-11-10", note: `absence-${tag}` })
    .run()
  db.insert(notifications).values({ userId, kind: "test", payload: { tag } }).run()
  db.insert(loginAttempts)
    .values({ email: `${tag}@example.nomail`, userId, success: true, reason: "ok", ip: `ip-${tag}` })
    .run()
  const now = new Date()
  db.insert(session)
    .values({ userId, token: `SESSION-TOKEN-${tag}`, expiresAt: new Date(Date.now() + 86_400_000), updatedAt: now })
    .run()
  db.insert(account)
    .values({
      userId,
      accountId: String(userId),
      providerId: "credential",
      password: `$argon2id$HASH-${tag}`,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  db.insert(apikey)
    .values({ referenceId: String(userId), key: `KEY-HASH-${tag}`, name: `key-${tag}`, createdAt: now, updatedAt: now })
    .run()
  db.insert(twoFactor)
    .values({ userId, secret: `TOTP-SECRET-${tag}`, backupCodes: `CODES-${tag}` })
    .run()
  db.insert(account)
    .values({
      userId,
      accountId: `sub-${tag}`,
      providerId: "oidc",
      accessToken: `ACCESS-TOKEN-${tag}`,
      idToken: `ID-TOKEN-${tag}`,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  db.insert(passkey)
    .values({
      userId,
      name: `passkey-${tag}`,
      publicKey: `PUBLIC-KEY-${tag}`,
      credentialID: `CRED-${tag}`,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      createdAt: now,
    })
    .run()
}

describe("export my data", () => {
  it("contains only the person's own data and no secrets", () => {
    const anna = makeUser({ name: "Anna", email: "anna@example.nomail" })
    const bert = makeUser({ name: "Bert", email: "bert@example.nomail" })
    fill(anna.id, "anna")
    fill(bert.id, "bert")
    const out = exportPersonalData(anna.id)
    const json = JSON.stringify(out)
    expect(json).toContain("note-anna")
    expect(json).toContain("absence-anna")
    expect(json).toContain("ip-anna")
    expect(json).toContain("key-anna")
    expect(json).not.toMatch(/bert/i)
    for (const secret of [
      "SESSION-TOKEN",
      "argon2id",
      "KEY-HASH",
      "TOTP-SECRET",
      "CODES-",
      "ACCESS-TOKEN",
      "ID-TOKEN",
      "PUBLIC-KEY",
      "CRED-",
      "sub-anna",
    ])
      expect(json).not.toContain(secret)
    expect(out.passkeys).toEqual([
      expect.objectContaining({ name: "passkey-anna", deviceType: "multiDevice", backedUp: true }),
    ])
    expect(out.signInMethods).toEqual(expect.arrayContaining([expect.objectContaining({ provider: "oidc" })]))
    expect(out).toMatchObject({ profile: { email: "anna@example.nomail" } })
    expect((out.timeEntries as unknown[]).length).toBe(1)
  })
})
