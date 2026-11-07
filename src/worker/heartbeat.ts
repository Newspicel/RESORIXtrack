import { eq } from "drizzle-orm"
import { db } from "@/server/db"
import { appState } from "@/server/db/schema"

export const HEARTBEAT_KEY = "worker_heartbeat"

export function beat(): void {
  const now = new Date().toISOString()
  db.insert(appState)
    .values({ key: HEARTBEAT_KEY, value: now })
    .onConflictDoUpdate({ target: appState.key, set: { value: now } })
    .run()
}

/** Seconds since the last heartbeat, or null if the worker never ran. */
export function heartbeatAge(): number | null {
  const row = db.select().from(appState).where(eq(appState.key, HEARTBEAT_KEY)).get()
  return row ? (Date.now() - Date.parse(row.value)) / 1000 : null
}
