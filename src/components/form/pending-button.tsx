import type { ComponentProps, ReactNode } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/**
 * Submit button for small native form Actions (`<form action={…}>`, no field validation): shows a spinner
 * in place of `icon` while the action runs. Validated TanStack forms use `form.SubmitButton`.
 */
export function PendingButton({
  icon,
  children,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "type"> & { icon?: ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending ? <Spinner data-icon="inline-start" /> : icon}
      {children}
    </Button>
  )
}
