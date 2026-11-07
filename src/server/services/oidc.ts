/**
 * Single sign-on via OpenID Connect (Better Auth genericOAuth, provider id "oidc").
 * No self-registration: a sign-in links only to an existing active person with the same (verified) email.
 */
import { and, eq, ne } from "drizzle-orm"
import { db } from "../db"
import { account, type User, users } from "../db/schema"
import { env } from "../env"
import { Conflict, NotFound } from "../errors"
import { hasPassword } from "./user-auth"

export const OIDC_PROVIDER = "oidc"

export function oidcEnabled(): boolean {
  return Boolean(env.oidc.issuer && env.oidc.clientId)
}

export function oidcConfig() {
  const enabled = oidcEnabled()
  return { enabled, name: env.oidc.name, only: enabled && env.oidc.only }
}

export type OidcDecision =
  | { ok: true; user: User; linked: boolean }
  | { ok: false; reason: "oidc_no_account" | "oidc_unverified" | "inactive"; user: User | null }

/**
 * Who an OIDC identity signs in as: the person already linked to this subject, else the active person
 * with the same email (verified by the provider unless OIDC_REQUIRE_VERIFIED_EMAIL=false).
 */
export function oidcDecision(
  claims: { sub: string; email?: string | null; emailVerified?: boolean | null },
  opts = { requireVerifiedEmail: env.oidc.requireVerifiedEmail },
): OidcDecision {
  const linked = db
    .select({ user: users })
    .from(account)
    .innerJoin(users, eq(users.id, account.userId))
    .where(and(eq(account.providerId, OIDC_PROVIDER), eq(account.accountId, claims.sub)))
    .get()?.user
  if (linked)
    return linked.isActive ? { ok: true, user: linked, linked: true } : { ok: false, reason: "inactive", user: linked }
  const email = (claims.email ?? "").trim().toLowerCase()
  const user = email ? db.select().from(users).where(eq(users.email, email)).get() : undefined
  if (!user) return { ok: false, reason: "oidc_no_account", user: null }
  if (!user.isActive) return { ok: false, reason: "inactive", user }
  if (opts.requireVerifiedEmail && claims.emailVerified !== true) return { ok: false, reason: "oidc_unverified", user }
  return { ok: true, user, linked: false }
}

export function hasOidcLink(userId: number): boolean {
  return Boolean(
    db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, OIDC_PROVIDER)))
      .get(),
  )
}

export interface LinkedProvider {
  id: number
  providerId: string
  name: string
  linkedAt: string
  canUnlink: boolean
}

export function linkedProviders(userId: number): LinkedProvider[] {
  const withPassword = hasPassword(userId)
  return db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), ne(account.providerId, "credential")))
    .all()
    .map((a) => ({
      id: a.id,
      providerId: a.providerId,
      name: a.providerId === OIDC_PROVIDER ? env.oidc.name : a.providerId,
      linkedAt: a.createdAt.toISOString(),
      canUnlink: withPassword || !env.oidc.only,
    }))
}

export function unlinkProvider(userId: number, accountId: number): void {
  const row = db
    .select()
    .from(account)
    .where(and(eq(account.id, accountId), eq(account.userId, userId), ne(account.providerId, "credential")))
    .get()
  if (!row) throw new NotFound("Not found")
  if (!hasPassword(userId) && env.oidc.only) throw new Conflict("Set a password first", { code: "unlink_last_login" })
  db.delete(account).where(eq(account.id, row.id)).run()
}
