/**
 * Break-glass password sign-in while OIDC_ONLY is on: `rt reset-password` allows one password sign-in for
 * that person within an hour (stored in app_state, consumed on success).
 */
import { eq } from "drizzle-orm"
import { db } from "../db"
import { appState } from "../db/schema"
import { fmtInstant, nowInstant, utcnow } from "../time"

const key = (email: string) => `break_glass:${email.trim().toLowerCase()}`

export function grantBreakGlass(email: string, minutes = 60): string {
  const until = fmtInstant(nowInstant().add({ minutes }))
  db.insert(appState)
    .values({ key: key(email), value: until })
    .onConflictDoUpdate({ target: appState.key, set: { value: until, updatedAt: utcnow() } })
    .run()
  return until
}

export function breakGlassAllowed(email: string): boolean {
  const row = db
    .select()
    .from(appState)
    .where(eq(appState.key, key(email)))
    .get()
  return Boolean(row && row.value > utcnow())
}

export function consumeBreakGlass(email: string): void {
  db.delete(appState)
    .where(eq(appState.key, key(email)))
    .run()
}
