/**
 * Better Auth: email + password (Argon2id), database sessions, TOTP two-factor with backup codes,
 * API keys (REST API), passkeys, the Have I Been Pwned check and optional OpenID Connect single sign-on. Its user
 * model is our `users` table.
 *
 * Sign-up is disabled: people are created by administrators and invited (services/invites). Every
 * sign-in attempt (password, second factor, passkey, OIDC) is written to login_attempts.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { apiKey } from "@better-auth/api-key"
import { passkey } from "@better-auth/passkey"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api"
import { genericOAuth, haveIBeenPwned, twoFactor } from "better-auth/plugins"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { and, eq } from "drizzle-orm"
import { isRecord } from "@/lib/guards"
import { CLIENT_IP_HEADER, withClientIp } from "./client-ip"
import { db } from "./db"
import * as schema from "./db/schema"
import { env } from "./env"
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword } from "./password"
import { breakGlassAllowed, consumeBreakGlass } from "./services/break-glass"
import { invalidateInvites, issueInviteToken } from "./services/invites"
import { loginThrottled, recordLoginAttempt, recordThrottled, resetThrottled } from "./services/login-log"
import { queueMail } from "./services/mail"
import { mfaRequiredFor } from "./services/mfa-policy"
import { OIDC_PROVIDER, oidcDecision, oidcEnabled } from "./services/oidc"
import { hasPassword, passwordProblem } from "./services/user-auth"
import { applySessionPolicy } from "./session-policy"
import { utcnow } from "./time"

/** Separate key for Better Auth derived from SECRET_KEY (cookie signing, 2FA secret encryption). */
const authSecret = createHash("sha256").update(`resorixtrack-auth:${env.secretKey}`).digest("hex")

/** Scopes for API keys (REST API). Stored as Better Auth permissions `{ resource: [actions] }`. */
export const API_SCOPES = {
  time: ["read", "write"],
  absences: ["read", "write"],
  reports: ["read"],
} as const

export const RESET_TOKEN_MINUTES = 120

export type SendAuthMail = (
  kind: "reset",
  to: { email: string; name: string; id: number },
  url: string,
) => Promise<void>
let sendAuthMail: SendAuthMail = async (_kind, to, url) => {
  const user = db.select().from(schema.users).where(eq(schema.users.id, to.id)).get()
  if (user)
    queueMail({ email: user.email, name: user.name, locale: user.locale }, "password_reset", {
      url,
      minutes: RESET_TOKEN_MINUTES,
    })
}
/** Replace the reset mailer (tests). */
export function setAuthMailer(fn: SendAuthMail) {
  sendAuthMail = fn
}

/**
 * Request-scoped context for things Better Auth callbacks cannot see: the request headers (sign-in log in
 * OIDC callbacks) and the reason of a sign-in started by our own code (invite, setup).
 */
const requestContext = new AsyncLocalStorage<{ headers?: Headers; signInReason?: string }>()

/** Run a server-side `auth.api.signInEmail` and log it with `reason` (e.g. "invite") instead of "ok". */
export function withSignInReason<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ ...requestContext.getStore(), signInReason: reason }, fn)
}

const fail = (status: "FORBIDDEN" | "TOO_MANY_REQUESTS" | "BAD_REQUEST", code: string, message: string) =>
  new APIError(status, { code, message })

function bodyOf(ctx: { body?: unknown }): Record<string, unknown> {
  return isRecord(ctx.body) ? ctx.body : {}
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

const emailOf = (ctx: { body?: unknown }) => str(bodyOf(ctx).email).trim().toLowerCase().slice(0, 254)

const userById = (id: number) => db.select().from(schema.users).where(eq(schema.users.id, id)).get()

const oidcPlugins = oidcEnabled()
  ? [
      genericOAuth({
        config: [
          {
            providerId: OIDC_PROVIDER,
            discoveryUrl: `${env.oidc.issuer}/.well-known/openid-configuration`,
            clientId: env.oidc.clientId,
            clientSecret: env.oidc.clientSecret || undefined,
            scopes: env.oidc.scopes,
            pkce: true,
            disableImplicitSignUp: true,
            disableSignUp: true,
            // Our linking rules (services/oidc). A rejected identity is answered with an empty email, which
            // Better Auth turns into an error redirect to /login without creating anything.
            mapProfileToUser: (profile) => {
              const sub = String(profile.sub ?? profile.id ?? "")
              const verified =
                profile.emailVerified || profile.email_verified === true || profile.email_verified === "true"
              const decision = oidcDecision({ sub, email: profile.email, emailVerified: verified })
              if (!decision.ok) {
                recordLoginAttempt({
                  email: (profile.email ?? "").toLowerCase(),
                  userId: decision.user?.id ?? null,
                  success: false,
                  reason: decision.reason,
                  headers: requestContext.getStore()?.headers,
                })
                return { email: "", name: "", emailVerified: false }
              }
              // sign in as the matched person; name and email are never taken over from the provider
              return { email: decision.user.email, name: decision.user.name, emailVerified: true }
            },
          },
        ],
      }),
    ]
  : []

const betterAuthInstance = betterAuth({
  appName: "RESORIXtrack",
  baseURL: env.baseUrl,
  basePath: "/api/auth",
  secret: authSecret,
  trustedOrigins: [env.baseUrl],
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      users: schema.users,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      twoFactor: schema.twoFactor,
      apikey: schema.apikey,
      passkey: schema.passkey,
    },
  }),
  user: { modelName: "users" },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: [OIDC_PROVIDER],
      requireLocalEmailVerified: false,
      updateUserInfoOnLink: false,
    },
  },
  onAPIError: { errorURL: `${env.baseUrl}/login` },
  advanced: {
    database: { generateId: "serial" },
    cookiePrefix: "rt",
    useSecureCookies: env.cookieSecure,
    ipAddress: {
      // set by withClientIp below from TRUSTED_PROXIES; a client cannot choose its rate-limit bucket
      ipAddressHeaders: [CLIENT_IP_HEADER],
      disableIpTracking: false,
    },
  },
  session: {
    // "keep me signed in"; the absolute cap and the idle timeout without it: session-policy.ts
    expiresIn: env.sessionRememberDays * 86400,
    updateAge: 86400,
    cookieCache: { enabled: false },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: RESET_TOKEN_MINUTES * 60,
    password: { hash: hashPassword, verify: verifyPassword },
    sendResetPassword: async ({ user, token }) => {
      const u = userById(Number(user.id))
      if (!u?.isActive) return
      // never activated: a fresh invitation instead of a reset link (as in v1)
      if (!hasPassword(u.id)) {
        issueInviteToken(u, null)
        return
      }
      // token in the fragment: never sent to the server or written to access logs
      await sendAuthMail("reset", { email: u.email, name: u.name, id: u.id }, `${env.baseUrl}/reset#token=${token}`)
    },
    onPasswordReset: async ({ user }) => {
      const id = Number(user.id)
      db.update(schema.users).set({ passwordChangedAt: utcnow() }).where(eq(schema.users.id, id)).run()
      invalidateInvites(id)
      db.delete(schema.apikey)
        .where(eq(schema.apikey.referenceId, String(id)))
        .run()
      recordLoginAttempt({
        email: user.email,
        userId: id,
        success: true,
        reason: "reset",
        headers: requestContext.getStore()?.headers,
      })
      const u = userById(id)
      if (u) queueMail({ email: u.email, name: u.name, locale: u.locale }, "password_changed")
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    // brute force is limited by failed attempts (login-log); these only stop floods
    customRules: {
      "/sign-in/email": { window: 60, max: 30 },
      "/two-factor/verify-totp": { window: 300, max: 10 },
      "/two-factor/verify-backup-code": { window: 300, max: 10 },
      "/request-password-reset": { window: 900, max: 10 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const u = userById(Number(session.userId))
          if (!u?.isActive) throw new APIError("FORBIDDEN", { message: "Account inactive", code: "INACTIVE" })
          return { data: session }
        },
        after: async (session) => {
          db.update(schema.users)
            .set({ lastLoginAt: utcnow() })
            .where(eq(schema.users.id, Number(session.userId)))
            .run()
        },
      },
    },
    user: {
      update: {
        after: async (user) => {
          // enrolling two-factor satisfies the re-enrolment request from import-v1
          if (user.twoFactorEnabled)
            db.update(schema.users)
              .set({ mfaReenrolRequired: false })
              .where(and(eq(schema.users.id, Number(user.id)), eq(schema.users.mfaReenrolRequired, true)))
              .run()
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const headers = ctx.request?.headers ?? ctx.headers
      // every lookup of the current session (also auth.api.getSession) passes here first
      const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret)
      if (token) {
        const short = await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret)
        applySessionPolicy(token, Boolean(short))
      }
      switch (ctx.path) {
        case "/sign-in/email": {
          const email = emailOf(ctx)
          if (env.oidc.only && oidcEnabled() && !requestContext.getStore()?.signInReason && !breakGlassAllowed(email))
            throw fail("FORBIDDEN", "OIDC_ONLY", "Sign in with single sign-on")
          if (loginThrottled(email, headers)) {
            recordThrottled(email, headers)
            throw fail("TOO_MANY_REQUESTS", "TOO_MANY_REQUESTS", "Too many failed attempts. Wait a few minutes.")
          }
          return
        }
        case "/request-password-reset": {
          const email = emailOf(ctx)
          if (loginThrottled(email, headers) || resetThrottled(email, headers))
            throw fail("TOO_MANY_REQUESTS", "TOO_MANY_REQUESTS", "Too many attempts. Wait a few minutes.")
          return
        }
        case "/change-password": {
          const session = await getSessionFromCtx(ctx)
          const problem = passwordProblem(str(bodyOf(ctx).newPassword), session?.user.email ?? "")
          if (problem) throw fail("BAD_REQUEST", `PASSWORD_${problem.toUpperCase()}`, "Choose a stronger password")
          return
        }
        case "/reset-password": {
          const resetToken = str(bodyOf(ctx).token)
          const v = resetToken
            ? db
                .select()
                .from(schema.verification)
                .where(eq(schema.verification.identifier, `reset-password:${resetToken}`))
                .get()
            : undefined
          const u = v ? userById(Number(v.value)) : undefined
          const problem = passwordProblem(str(bodyOf(ctx).newPassword), u?.email ?? "")
          if (problem) throw fail("BAD_REQUEST", `PASSWORD_${problem.toUpperCase()}`, "Choose a stronger password")
          return
        }
        case "/two-factor/disable": {
          const session = await getSessionFromCtx(ctx)
          const u = session ? userById(Number(session.user.id)) : undefined
          if (u && mfaRequiredFor(u))
            throw fail("FORBIDDEN", "MFA_REQUIRED", "Two-factor authentication is required for your account")
          return
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      const headers = ctx.request?.headers ?? ctx.headers
      const newSession = ctx.context.newSession
      const returned: unknown = ctx.context.returned
      switch (ctx.path) {
        case "/sign-in/email": {
          const email = emailOf(ctx)
          if (
            returned instanceof APIError &&
            (returned.body?.code === "OIDC_ONLY" || returned.status === "TOO_MANY_REQUESTS")
          )
            return
          if (newSession) {
            consumeBreakGlass(email)
            const reason = requestContext.getStore()?.signInReason ?? "ok"
            recordLoginAttempt({ email, userId: Number(newSession.user.id), success: true, reason, headers })
          } else if (isRecord(returned) && returned.twoFactorRedirect === true) {
            return // logged when the second factor is verified
          } else {
            const inactive = returned instanceof APIError && returned.body?.code === "INACTIVE"
            recordLoginAttempt({ email, success: false, reason: inactive ? "inactive" : "invalid_password", headers })
          }
          return
        }
        case "/two-factor/verify-totp":
        case "/two-factor/verify-backup-code": {
          // only the sign-in step (a pending two-factor challenge cookie), not enrolment while signed in
          const challenge = await ctx.getSignedCookie(
            ctx.context.createAuthCookie("two_factor").name,
            ctx.context.secret,
          )
          if (!challenge) return
          if (newSession) {
            recordLoginAttempt({
              email: newSession.user.email,
              userId: Number(newSession.user.id),
              success: true,
              // "token_issued" when the app sign-in (services/app-sign-in) verifies the second factor
              reason: requestContext.getStore()?.signInReason ?? "ok",
              headers,
            })
          } else if (returned instanceof APIError) {
            const v = db.select().from(schema.verification).where(eq(schema.verification.identifier, challenge)).get()
            const u = v ? userById(Number(v.value)) : undefined
            if (u) recordLoginAttempt({ email: u.email, userId: u.id, success: false, reason: "mfa_failed", headers })
          }
          return
        }
        case "/request-password-reset": {
          if (returned instanceof APIError) return
          recordLoginAttempt({ email: emailOf(ctx), success: false, reason: "reset_requested", headers })
          return
        }
        case "/passkey/verify-authentication": {
          if (newSession)
            recordLoginAttempt({
              email: newSession.user.email,
              userId: Number(newSession.user.id),
              success: true,
              reason: "ok_passkey",
              headers,
            })
          return
        }
        case "/callback/:id": {
          if (newSession)
            recordLoginAttempt({
              email: newSession.user.email,
              userId: Number(newSession.user.id),
              success: true,
              reason: "ok_oidc",
              headers,
            })
          return
        }
      }
    }),
  },
  plugins: [
    twoFactor({ issuer: "RESORIXtrack", backupCodeOptions: { amount: 10, length: 10 } }),
    apiKey({
      defaultPrefix: "rt_",
      enableMetadata: true,
      rateLimit: { enabled: false },
      permissions: { defaultPermissions: { time: ["read"] } },
    }),
    // passkeys are phishing-resistant on their own: a passkey sign-in never asks for TOTP
    passkey({
      rpID: new URL(env.baseUrl || "http://localhost").hostname,
      rpName: "RESORIXtrack",
      origin: env.baseUrl || undefined,
    }),
    ...oidcPlugins,
    ...(env.pwnedCheck ? [haveIBeenPwned()] : []),
    tanstackStartCookies(),
  ],
})

// Wrap the HTTP entry point: the client address for the rate limiter, and the request headers for
// callbacks deep inside Better Auth.
const innerHandler = betterAuthInstance.handler
betterAuthInstance.handler = (request: Request) => {
  const req = withClientIp(request)
  return requestContext.run({ headers: req.headers }, () => innerHandler(req))
}

export const auth = betterAuthInstance
export type AuthSession = typeof auth.$Infer.Session
