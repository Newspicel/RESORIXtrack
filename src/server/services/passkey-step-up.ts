/**
 * Adding a passkey needs the password first (people without one, e.g. single sign-on only, confirm nothing):
 * a passkey replaces password and second factor, so a stolen session must not be able to plant one. The
 * confirmation is kept for a few minutes in app_state and used up by a successful registration.
 */
import { eq } from "drizzle-orm"
import { db } from "../db"
import { appState } from "../db/schema"
import { fmtInstant, nowInstant, utcnow } from "../time"

const MINUTES = 5
const key = (userId: number) => `passkey_step_up:${userId}`

export function grantPasskeyRegistration(userId: number): void {
  const until = fmtInstant(nowInstant().add({ minutes: MINUTES }))
  db.insert(appState)
    .values({ key: key(userId), value: until })
    .onConflictDoUpdate({ target: appState.key, set: { value: until, updatedAt: utcnow() } })
    .run()
}

export function passkeyRegistrationAllowed(userId: number): boolean {
  const row = db
    .select()
    .from(appState)
    .where(eq(appState.key, key(userId)))
    .get()
  return Boolean(row && row.value > utcnow())
}

export function consumePasskeyRegistration(userId: number): void {
  db.delete(appState)
    .where(eq(appState.key, key(userId)))
    .run()
}
