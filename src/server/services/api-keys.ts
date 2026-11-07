/**
 * Administrator overview of every API key in the company (as v1 under Backups & logs): owner, scopes, use and
 * expiry, never the key itself. An administrator can revoke any key with a reason; the key stays listed as
 * revoked, the change is logged and the owner is notified.
 */
import { and, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db"
import { apikey, users } from "../db/schema"
import { NotFound } from "../errors"
import { notify } from "./notifications"
import { type Actor, requireAdmin } from "./permissions"
import { record, snapshot } from "./revisions"

export interface ApiKeyFilters {
  status?: "active" | "all"
  page?: number
  pageSize?: number
}

const Permissions = z.record(z.string(), z.array(z.string()))

/** `resource:action` scopes of a key's stored permissions (Better Auth's JSON column). */
export function apiKeyScopes(permissions: string | null): string[] {
  const parsed = Permissions.safeParse(permissions ? JSON.parse(permissions) : {})
  if (!parsed.success) return []
  return Object.entries(parsed.data).flatMap(([res, actions]) => actions.map((a) => `${res}:${a}`))
}

const ownerId = sql<number>`cast(${apikey.referenceId} as integer)`

export function listAllApiKeys(actor: Actor, f: ApiKeyFilters = {}) {
  requireAdmin(actor)
  const pageSize = Math.min(200, Math.max(10, f.pageSize ?? 50))
  const page = Math.max(1, f.page ?? 1)
  const now = new Date()
  const where =
    f.status === "active"
      ? and(eq(apikey.enabled, true), or(isNull(apikey.expiresAt), gt(apikey.expiresAt, now)))
      : undefined
  const total = db.select({ n: count() }).from(apikey).where(where).get()?.n ?? 0
  const rows = db
    .select({ k: apikey, ownerName: users.name, ownerEmail: users.email })
    .from(apikey)
    .leftJoin(users, eq(users.id, ownerId))
    .where(where)
    .orderBy(desc(apikey.createdAt), desc(apikey.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()
  return {
    total,
    page,
    pageSize,
    items: rows.map(({ k, ownerName, ownerEmail }) => ({
      id: k.id,
      ownerId: Number(k.referenceId),
      ownerName: ownerName ?? "",
      ownerEmail: ownerEmail ?? "",
      name: k.name ?? "",
      start: k.start ?? k.prefix ?? "",
      scopes: apiKeyScopes(k.permissions),
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastRequest ? k.lastRequest.toISOString() : null,
      expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
      uses: k.requestCount ?? 0,
      enabled: k.enabled !== false,
      expired: Boolean(k.expiresAt && k.expiresAt <= now),
    })),
  }
}
export type AdminApiKey = ReturnType<typeof listAllApiKeys>["items"][number]

const snapshotOf = (k: typeof apikey.$inferSelect) => ({
  id: k.id,
  name: k.name ?? "",
  start: k.start ?? k.prefix ?? "",
  scopes: apiKeyScopes(k.permissions).join(" "),
  enabled: k.enabled !== false,
  expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
})

/** Disable a key (it stays listed as revoked). Idempotent. */
export function revokeApiKeyAsAdmin(actor: Actor, keyId: number, reason: string): void {
  requireAdmin(actor)
  const k = db.select().from(apikey).where(eq(apikey.id, keyId)).get()
  if (!k) throw new NotFound("Key not found")
  if (k.enabled === false) return
  const updated = db
    .update(apikey)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(apikey.id, keyId))
    .returning()
    .get()
  const owner = Number(k.referenceId)
  const why = reason.trim().slice(0, 500)
  record({
    entity: "api_token",
    row: snapshotOf(updated),
    action: "revoke",
    actor,
    subjectUserId: owner,
    before: snapshot("api_token", snapshotOf(k)),
    reason: why || "Revoked by an administrator",
  })
  if (owner !== actor.id)
    notify(owner, "token_revoked", { actor_name: actor.user.name, name: k.name ?? "", reason: why })
}
