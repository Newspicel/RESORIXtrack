/** Two-factor policy: who must use a second factor, and who satisfies it. */
import { eq } from "drizzle-orm"
import { db } from "../db"
import { passkey, type User } from "../db/schema"
import { hasOidcLink } from "./oidc"
import { getSetting } from "./settings"

export function mfaPolicyApplies(user: Pick<User, "role">): boolean {
  return getSetting("mfa_required_for_all") || (user.role === "admin" && getSetting("mfa_required_for_admins"))
}

export function hasPasskey(userId: number): boolean {
  return Boolean(db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, userId)).get())
}

/** Strong sign-in without TOTP: a registered passkey, or a link to the single sign-on provider (it handles the second factor). */
function strongAlternative(userId: number): boolean {
  return hasPasskey(userId) || hasOidcLink(userId)
}

export function mfaSatisfied(user: Pick<User, "id" | "twoFactorEnabled">): boolean {
  return Boolean(user.twoFactorEnabled) || strongAlternative(user.id)
}

/** Must the person keep TOTP on (it may not be disabled)? */
export function mfaRequiredFor(user: Pick<User, "id" | "role">): boolean {
  return mfaPolicyApplies(user) && !strongAlternative(user.id)
}

/** Show the enrolment banner: policy or v1 re-enrolment applies and nothing satisfies it yet. */
export function mfaEnrolmentDue(user: Pick<User, "id" | "role" | "twoFactorEnabled" | "mfaReenrolRequired">): boolean {
  return (mfaPolicyApplies(user) || user.mfaReenrolRequired) && !mfaSatisfied(user)
}
