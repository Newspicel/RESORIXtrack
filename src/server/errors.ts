/**
 * Domain errors. Services throw these; server functions pass them to the client (code, message, fields
 * survive serialisation), the REST layer maps them to `{"error": {"code", "message", "fields"}}`.
 * `message` is English (logs, API); the UI translates by `code` (i18n namespace `errors`) and falls back
 * to the message.
 */
import { describeError, isRecord } from "@/lib/guards"

export type ErrorFields = Record<string, unknown>

export class AppError extends Error {
  code: string
  status: number
  fields?: ErrorFields
  constructor(message: string, opts: { code?: string; status?: number; fields?: ErrorFields } = {}) {
    super(message)
    this.name = "AppError"
    this.code = opts.code ?? "bad_request"
    this.status = opts.status ?? 400
    if (opts.fields) this.fields = opts.fields
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) }
  }
}

const make = (status: number, defCode: string) =>
  class extends AppError {
    constructor(message: string, opts: { code?: string; fields?: ErrorFields } = {}) {
      super(message, { status, code: opts.code ?? defCode, fields: opts.fields })
    }
  }

export const Unauthorized = make(401, "unauthorized")
export const Forbidden = make(403, "forbidden")
export const NotFound = make(404, "not_found")
export const Conflict = make(409, "conflict")
export const Validation = make(422, "validation_error")
export const TooManyRequests = make(429, "too_many_requests")

/** Map a SQLite trigger abort (database guard) to a domain error, or return null. */
export function guardError(err: unknown): AppError | null {
  const msg = describeError(err)
  if (msg.includes("resorixtrack: period signed off"))
    return new Conflict("This change is not allowed: the period has been signed off", { code: "period_signed_off" })
  if (msg.includes("resorixtrack: sign-offs are immutable"))
    return new Conflict("Protected records cannot be changed", { code: "signoff_immutable" })
  if (msg.includes("resorixtrack: change log is append-only"))
    return new Conflict("Protected records cannot be changed", { code: "revisions_append_only" })
  return null
}

type Issue = { path: PropertyKey[]; code: string; message: string }

const isIssue = (v: unknown): v is Issue =>
  isRecord(v) && Array.isArray(v.path) && typeof v.code === "string" && typeof v.message === "string"

/** zod issues → `{ field.path: code }` (codes are translated through `errors.fields.<code>`). */
function zodFields(issues: Issue[]): ErrorFields {
  const fields: ErrorFields = {}
  for (const i of issues) {
    const key = i.path.map(String).join(".") || "_"
    fields[key] ??= /^[a-z_.]+$/.test(i.message) ? i.message : i.code === "invalid_type" ? "required" : "invalid"
  }
  return fields
}

/** Normalise anything thrown into an AppError (unknown errors become a generic 500 without details). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (isRecord(err) && typeof err.name === "string" && err.name.includes("ZodError")) {
    const issues: unknown = err.issues
    if (Array.isArray(issues) && issues.every(isIssue))
      return new Validation("Validation failed", { fields: zodFields(issues) })
  }
  const g = guardError(err)
  if (g) return g
  return new AppError("Internal server error", { status: 500, code: "server_error" })
}
