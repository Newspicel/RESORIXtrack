import type { AnyFormApi } from "@tanstack/react-form"
import { errorFields } from "@/lib/guards"

/** Map server-side field errors (AppError.fields) onto form fields. Returns true when any was mapped. */
export function applyServerErrors(form: AnyFormApi, err: unknown): boolean {
  const fields = errorFields(err)
  if (!fields) return false
  for (const [name, msg] of Object.entries(fields)) {
    form.setFieldMeta(name, (m) => ({ ...m, isBlurred: true, errorMap: { ...m.errorMap, onServer: String(msg) } }))
  }
  return true
}
