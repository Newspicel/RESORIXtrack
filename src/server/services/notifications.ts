/**
 * In-app notifications (bell). `kind` + `payload` are rendered by the client via i18n
 * (namespace `notifications`, key = kind, payload = interpolation values). Emails are sent separately
 * by the caller through services/mail.ts after the transaction commits.
 */
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm"
import type { JsonObject } from "@/lib/json"
import { db } from "../db"
import { type Notification, notifications } from "../db/schema"
import { iso, utcnow } from "../time"

export function notify(userId: number, kind: string, payload: JsonObject = {}): void {
  db.insert(notifications).values({ userId, kind, payload }).run()
}

export function serializeNotification(n: Notification) {
  return { id: n.id, kind: n.kind, payload: n.payload, read: n.readAt != null, createdAt: iso(n.createdAt) }
}

export function listNotifications(userId: number, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const conds = [eq(notifications.userId, userId)]
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt))
  return db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(opts.limit ?? 50)
    .all()
}

export function unreadCount(userId: number): number {
  return (
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .get()?.n ?? 0
  )
}

export function markRead(userId: number, ids: number[] | null): number {
  const conds = [eq(notifications.userId, userId), isNull(notifications.readAt)]
  if (ids) conds.push(inArray(notifications.id, ids))
  return db
    .update(notifications)
    .set({ readAt: utcnow() })
    .where(and(...conds))
    .run().changes
}
