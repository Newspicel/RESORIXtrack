/**
 * Server-only helpers of the profile server functions. Kept out of api.ts so the client bundle never
 * pulls in Better Auth, the database or Argon2 (only code inside handlers is stripped from it).
 */
import { getRequestHeaders } from "@tanstack/react-start/server"
import { APIError } from "better-auth/api"
import { and, eq } from "drizzle-orm"
import { API_SCOPES, auth } from "@/server/auth"
import { db } from "@/server/db"
import { account } from "@/server/db/schema"
import { AppError, TooManyRequests, Validation } from "@/server/errors"
import { verifyPassword } from "@/server/password"

export const headers = () => getRequestHeaders()

export async function currentSessionId(): Promise<number | null> {
  const s = await auth.api.getSession({ headers: headers() })
  return s ? Number(s.session.id) : null
}

/** Better Auth errors as our domain errors (codes the UI translates). */
export function fromAuthError(err: unknown, passwordField = "newPassword"): never {
  if (!(err instanceof APIError)) throw err
  const code = err.body?.code ?? ""
  if (code === "INVALID_PASSWORD")
    throw new Validation("Current password is incorrect", {
      code: "invalid_password",
      fields: { currentPassword: "invalid" },
    })
  if (code === "PASSWORD_COMPROMISED")
    throw new Validation("Password appears in data breaches", {
      code: "password_breached",
      fields: { [passwordField]: "breached" },
    })
  if (code === "PASSWORD_TOO_SHORT")
    throw new Validation("Password too short", { code: "password_too_short", fields: { [passwordField]: "too_short" } })
  const m = code.match(/^PASSWORD_(TOO_LONG|TOO_COMMON|CONTAINS_EMAIL)$/)
  if (m)
    throw new Validation("Choose a stronger password", {
      code: `password_${m[1].toLowerCase()}`,
      fields: { [passwordField]: m[1].toLowerCase() },
    })
  if (err.status === "TOO_MANY_REQUESTS") throw new TooManyRequests("Too many attempts")
  throw new AppError(err.message || "Request failed", { code: code.toLowerCase() || "bad_request" })
}

export function passwordMatches(userId: number, password: string): Promise<boolean> {
  const row = db
    .select({ p: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .get()
  return row?.p ? verifyPassword({ hash: row.p, password }) : Promise.resolve(false)
}

export const SCOPE_LIST = Object.entries(API_SCOPES).flatMap(([res, actions]) => actions.map((a) => `${res}:${a}`))
