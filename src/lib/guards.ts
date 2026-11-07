/** Runtime narrowing for values that cross a boundary (thrown errors, JSON, widget callbacks). Client-safe. */
import type { Json, JsonObject } from "./json"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** `value` is one of the listed literals (e.g. a Select/Tabs value narrowed back to its union). */
export function isOneOf<const T extends string | number>(values: readonly T[], value: unknown): value is T {
  return values.some((v) => v === value)
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
}

/** `code` of a thrown AppError (it survives server function serialisation). */
export function errorCode(err: unknown): string | undefined {
  return isRecord(err) && typeof err.code === "string" ? err.code : undefined
}

export function errorMessage(err: unknown): string | undefined {
  return isRecord(err) && typeof err.message === "string" ? err.message : undefined
}

/** The message of anything thrown (an Error, an error-like object, or any other value), for logs. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return errorMessage(err) ?? String(err)
}

/** Anything thrown, as an Error (callbacks such as Node stream callbacks expect one). */
export function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(describeError(err))
}

/** Field errors of a thrown AppError (`{ field: code }`). */
export function errorFields(err: unknown): Record<string, unknown> | undefined {
  return isRecord(err) && isRecord(err.fields) ? err.fields : undefined
}

/**
 * Change handler for a single-choice widget (Tabs, Select, or a ToggleGroup, which reports an array):
 * applies only listed values, so deselecting the pressed toggle keeps the current choice.
 */
export function whenOneOf<const T extends string>(values: readonly T[], apply: (value: T) => void) {
  return (value: unknown) => {
    const one = Array.isArray(value) ? value[0] : value
    if (isOneOf(values, one)) apply(one)
  }
}

/** A JSON-safe copy of an unknown value (what `JSON.stringify` would keep; dates become ISO strings). */
export function toJson(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toJson)
  if (isRecord(value)) return toJsonObject(value)
  return null
}

export function toJsonObject(value: Record<string, unknown>): JsonObject {
  const out: JsonObject = {}
  for (const [k, v] of Object.entries(value)) if (v !== undefined && typeof v !== "function") out[k] = toJson(v)
  return out
}
