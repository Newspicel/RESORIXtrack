import { useQueryClient } from "@tanstack/react-query"
import { errorFields } from "@/lib/guards"
import { uploadAttachmentFn } from "./api"

/** Everything that shows absences or figures derived from them. */
const AFFECTED = [["absences"], ["account"], ["team"], ["time"], ["dashboard"], ["bootstrap"]] as const

export function useRefreshAbsences() {
  const qc = useQueryClient()
  return () => Promise.all(AFFECTED.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })))
}

export function uploadDocument(absenceId: number, file: File) {
  const fd = new FormData()
  fd.set("absenceId", String(absenceId))
  fd.set("file", file)
  return uploadAttachmentFn({ data: fd })
}

/** Server field errors (`{ endDate: "too_long" }`) as translation keys for the form kit. */
export function serverFieldErrors(err: unknown): { fields: Record<string, string> } | null {
  const fields = errorFields(err)
  if (!fields) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) if (typeof v === "string") out[k] = `errors.fields.${v}`
  return Object.keys(out).length ? { fields: out } : null
}
