import { useEffect, useSyncExternalStore } from "react"
import { z } from "zod"

// same as server/password.ts (not imported: that module pulls Argon2 into the client bundle)
const MIN_PASSWORD_LENGTH = 10

/** Field validators for "new password" + "repeat" pairs (server checks the full policy). */
export const newPasswordValidator = z.string().min(MIN_PASSWORD_LENGTH, "auth.password_rules")

/** Error key when the repeated password differs (field validator of the "repeat" field). */
export function passwordsDiffer(value: string, other: unknown): string | undefined {
  return value !== other ? "auth.passwords_differ" : undefined
}

let fragmentToken: string | null = null
const noSubscribe = () => () => {}

function readFragmentToken(): string {
  fragmentToken ??= new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? ""
  return fragmentToken
}

/**
 * Token from the URL fragment (`#token=…`, never sent to the server or its logs); `null` during server
 * rendering. The fragment is removed from the address bar once read.
 */
export function useFragmentToken(): string | null {
  const token = useSyncExternalStore(noSubscribe, readFragmentToken, () => null)
  useEffect(() => {
    if (token) history.replaceState(null, "", window.location.pathname)
  }, [token])
  return token
}
