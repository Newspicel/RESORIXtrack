/**
 * Confirmation is for irreversible, high-consequence actions only (anonymise a person, delete a team,
 * restore a backup). Reversible actions run immediately and offer Undo (see `undoToast`).
 * With `typeToConfirm`, the user must type the given text – effortful, not reflexive. The destructive
 * button is never the default focus.
 */
import { type ReactNode, useId, useState } from "react"
import { PendingButton } from "@/components/form/pending-button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  typeToConfirm,
  destructive = true,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel: string
  typeToConfirm?: string
  destructive?: boolean
  onConfirm: () => unknown
  children?: ReactNode
}) {
  const confirmTypeId = useId()
  const t = useT()
  const [typed, setTyped] = useState("")
  // a form Action: the confirm button shows its pending state; errors are reported by onConfirm itself
  // and the dialog stays open
  const confirm = async () => {
    try {
      await onConfirm()
    } catch {
      return
    }
    setTyped("")
    onOpenChange(false)
  }
  const ok = !typeToConfirm || typed.trim() === typeToConfirm
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped("")
        onOpenChange(o)
      }}
    >
      <AlertDialogContent>
        <form action={confirm} className="contents">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          {children}
          {typeToConfirm ? (
            <Field>
              <FieldLabel htmlFor={confirmTypeId}>{t("common.type_to_confirm", { text: typeToConfirm })}</FieldLabel>
              <Input id={confirmTypeId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              <FieldDescription>{t("common.irreversible")}</FieldDescription>
            </Field>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <PendingButton variant={destructive ? "destructive" : "default"} disabled={!ok}>
              {confirmLabel}
            </PendingButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
