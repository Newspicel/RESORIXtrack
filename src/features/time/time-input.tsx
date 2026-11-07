/**
 * Time-of-day input that follows the profile's 24/12 h format in every browser. `value`/`onChange` use
 * "HH:MM" (24 h); typing is lenient ("930", "9.30", "9:30 pm") and committed on blur or Enter.
 */
import { useStore } from "@tanstack/react-form"
import { type ComponentProps, type ReactNode, useId, useState } from "react"
import { useFieldContext } from "@/components/form/form"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { errorMessage } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { fmtClockTime, parseTimeText } from "./lib"

export function TimeInput({
  value,
  onChange,
  onBlur,
  ...rest
}: { value: string; onChange: (hhmm: string) => void; onBlur?: () => void } & Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange" | "onBlur" | "type"
>) {
  const hour12 = useMe().timeFormat === "12h"
  const shown = value ? fmtClockTime(value, hour12) : ""
  const [text, setText] = useState(shown)
  const [synced, setSynced] = useState(value)
  // an outside change (reset, default) replaces what is shown unless the typed text already means it
  if (synced !== value) {
    setSynced(value)
    if (parseTimeText(text) !== (value || null)) setText(shown)
  }
  const commit = () => {
    const parsed = parseTimeText(text)
    if (!text.trim()) {
      if (value) onChange("")
    } else if (parsed) {
      setText(fmtClockTime(parsed, hour12))
      if (parsed !== value) onChange(parsed)
    }
    onBlur?.()
  }
  return (
    <Input
      type="text"
      inputMode={hour12 ? "text" : "numeric"}
      autoComplete="off"
      placeholder={hour12 ? "h:mm AM" : "HH:MM"}
      className="tabular"
      {...rest}
      value={text}
      onChange={(e) => {
        const v = e.target.value
        setText(v)
        // a complete time is committed while typing; partial input waits for blur or Enter
        if (/^\d{1,2}[:.]\d{2}(\s*[ap]\.?m?\.?)?$/i.test(v.trim())) {
          const parsed = parseTimeText(v)
          if (parsed && parsed !== value) onChange(parsed)
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit()
        rest.onKeyDown?.(e)
      }}
    />
  )
}

/** TimeInput bound to a TanStack form field (use inside `form.AppField`). */
export function TimeField({
  label,
  description,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  className?: string
}) {
  const field = useFieldContext<string>()
  const { t } = useI18n()
  const submitted = useStore(field.form.store, (s) => s.submissionAttempts > 0)
  const raw =
    (field.state.meta.isBlurred || submitted) && field.state.meta.errors.length ? field.state.meta.errors[0] : null
  const error = raw ? t(typeof raw === "string" ? raw : (errorMessage(raw) ?? "")) : ""
  const id = `${useId()}${field.name}`
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <TimeInput
        id={id}
        name={field.name}
        data-field={field.name}
        value={field.state.value ?? ""}
        onChange={(v) => field.handleChange(v)}
        onBlur={field.handleBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      {error ? (
        <FieldError id={`${id}-err`}>{error}</FieldError>
      ) : description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}
