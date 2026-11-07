/**
 * Settings layout (admin settings, profile, person detail): a group is a titled card whose rows are separated
 * by hairlines; a row puts the label and a short hint on the left and the control on the right. Below `md`
 * rows stack (label above control); switches stay on the right at every width.
 *
 *   <SettingsGroup title={t("…")}>
 *     <SettingRow label="Company name" htmlFor={id} control={<Input id={id} className="w-72" />} />
 *     <SettingRow label="Two-factor" hint="Required for admins" inline control={<Switch />} />
 *   </SettingsGroup>
 *
 * Control widths: switches as they are, number inputs `w-28`, segmented controls `w-auto`, selects and
 * text up to `w-72`. `block` rows put a wide control (textarea, list, table) below the label.
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function SettingsGroup({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {title || actions ? (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div
        data-slot="settings-group"
        className={cn("flex flex-col divide-y overflow-hidden rounded-xl border bg-card", bodyClassName)}
      >
        {children}
      </div>
    </section>
  )
}

export function SettingRow({
  label,
  hint,
  htmlFor,
  labelId,
  control,
  error,
  inline = false,
  block = false,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  /** id of the control the label names */
  htmlFor?: string
  /** id of the label, for controls named by `aria-labelledby` (segmented, radio groups) */
  labelId?: string
  control: ReactNode
  /** replaces the hint while set */
  error?: ReactNode
  /** keep label and control side by side on phones too (switches) */
  inline?: boolean
  /** control below the label at every width (textarea, list) */
  block?: boolean
  className?: string
}) {
  const Label = htmlFor ? "label" : "span"
  return (
    <div
      data-slot="setting-row"
      data-invalid={error ? true : undefined}
      className={cn(
        "flex min-h-14 gap-x-6 gap-y-2 px-5 py-3",
        block
          ? "flex-col"
          : inline
            ? "items-center justify-between"
            : "flex-col md:flex-row md:items-center md:justify-between",
        className,
      )}
    >
      <div className={cn("flex min-w-0 flex-col gap-0.5", !block && "md:max-w-[50%]")}>
        <Label htmlFor={htmlFor} id={labelId} className="text-sm font-medium text-pretty">
          {label}
        </Label>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : hint ? (
          <p className="text-xs text-muted-foreground text-pretty">{hint}</p>
        ) : null}
      </div>
      <div
        className={cn(
          "flex min-w-0 items-center gap-2",
          block ? "w-full" : inline ? "shrink-0" : "w-full md:w-auto md:shrink-0 md:justify-end",
        )}
      >
        {control}
      </div>
    </div>
  )
}

/** Save bar spanning the page width; sticky with the unsaved state while there are changes. */
export function SaveBar({ dirty, label, children }: { dirty: boolean; label: ReactNode; children: ReactNode }) {
  return (
    <div
      data-slot="save-bar"
      data-dirty={dirty || undefined}
      className={cn(
        "-mx-4 flex items-center justify-end gap-3 px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
        // sticks to the bottom edge only while there is something to save
        dirty && "sticky bottom-36 z-10 border-t bg-background/90 backdrop-blur md:bottom-0",
      )}
    >
      {dirty ? (
        <span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-2 rounded-full bg-warning" aria-hidden />
          {label}
        </span>
      ) : null}
      {children}
    </div>
  )
}

/** Last row of a group holding its form's actions (right) and an optional note (left). */
export function SettingsFooter({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div data-slot="settings-footer" className="flex flex-wrap items-center justify-end gap-3 bg-muted/30 px-5 py-3">
      {note ? <span className="mr-auto text-xs text-muted-foreground">{note}</span> : null}
      {children}
    </div>
  )
}
