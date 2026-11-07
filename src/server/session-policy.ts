/**
 * Session limits on top of Better Auth (as in v1): every session ends SESSION_ABSOLUTE_DAYS after sign-in,
 * however often it is used; a session without "keep me signed in" ends after SESSION_SHORT_IDLE_HOURS
 * without activity. Better Auth never refreshes such a session (it marks it with its `dont_remember`
 * cookie), so we slide `updatedAt` and `expiresAt` here.
 */
import { eq } from "drizzle-orm"
import { db } from "./db"
import { session } from "./db/schema"
import { env } from "./env"

const HOUR_MS = 3_600_000
/** Write the activity stamp at most this often (keeps SQLite writes low). */
const SLIDE_EVERY_MS = 5 * 60_000

export type SessionVerdict = "none" | "ok" | "revoked"

export function applySessionPolicy(token: string, short: boolean, now = Date.now()): SessionVerdict {
  const row = db.select().from(session).where(eq(session.token, token)).get()
  if (!row) return "none"
  const absoluteEnd = row.createdAt.getTime() + env.sessionAbsoluteDays * 24 * HOUR_MS
  const idleEnd = row.updatedAt.getTime() + env.sessionShortIdleHours * HOUR_MS
  if (now >= absoluteEnd || (short && now >= idleEnd)) {
    db.delete(session).where(eq(session.id, row.id)).run()
    return "revoked"
  }
  if (short && now - row.updatedAt.getTime() >= SLIDE_EVERY_MS) {
    const expiresAt = new Date(Math.min(now + env.sessionShortIdleHours * HOUR_MS, absoluteEnd))
    db.update(session)
      .set({ updatedAt: new Date(now), expiresAt })
      .where(eq(session.id, row.id))
      .run()
  }
  return "ok"
}
