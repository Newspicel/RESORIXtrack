/**
 * Asked on save once dated values changed: the first day they apply ("" = today). A server error on the date
 * stays at the field; any other failure closes the dialog and goes to `onFail`, so the form can show it.
 */
import { type ReactNode, useId, useState } from "react"
import { PendingButton } from "@/components/form/pending-button"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { errorFields } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { ResponsiveDialog } from "./responsive-dialog"

export function EffectiveDateDialog({
  label,
  hint,
  errorField,
  onSubmit,
  onFail,
  onClose,
}: {
  label: ReactNode
  hint: ReactNode
  /** the server's field name for the date */
  errorField: string
  onSubmit: (from: string) => Promise<void>
  onFail: (err: unknown) => void
  onClose: () => void
}) {
  const id = useId()
  const { t, has } = useI18n()
  const [from, setFrom] = useState("")
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    try {
      await onSubmit(from)
      onClose()
    } catch (err) {
      const code = errorFields(err)?.[errorField]
      if (code == null) {
        onClose()
        onFail(err)
        return
      }
      const key = `errors.fields.${typeof code === "string" ? code : "invalid"}`
      setError(has(key) ? t(key) : t("errors.fields.invalid"))
      document.getElementById(id)?.focus()
    }
  }
  return (
    <ResponsiveDialog
      open
      variant="dialog"
      size="sm"
      onOpenChange={(o) => !o && onClose()}
      title={t("admin.common.changes_from_title")}
      action={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <PendingButton>{t("common.save")}</PendingButton>
        </>
      }
    >
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <DatePicker
          id={id}
          value={from}
          onChange={(v) => {
            setFrom(v)
            setError(null)
          }}
          placeholder={t("common.today")}
          invalid={error != null}
          aria-describedby={`${id}-help`}
          far
        />
        {error ? (
          <FieldError id={`${id}-help`}>{error}</FieldError>
        ) : (
          <FieldDescription id={`${id}-help`}>{hint}</FieldDescription>
        )}
      </Field>
    </ResponsiveDialog>
  )
}
