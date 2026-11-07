/**
 * Segmented control: the one widget for a single choice among 2 to 5 options (docs/design.md, Controls).
 * A tinted track (36 px) holding segments (32 px, radius = track radius − padding); the selected segment is
 * raised. Built on Base UI's ToggleGroup, so arrow keys move between segments and each one is a pressed/not
 * pressed toggle button.
 *
 *   <Segmented value={view} onValueChange={setView} aria-label={t("time.view")}
 *     options={[{ value: "week", label: t("time.week") }, { value: "month", label: t("time.month") }]} />
 *
 * `fill` stretches the segments over the available width (forms). An option with a `description` renders as a
 * two-line segment (title + muted scope text), for choices whose meaning needs a few words.
 */

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** a status colour class for a small dot before the label, e.g. `bg-work` */
  dot?: string
  icon?: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export function Segmented<const T extends string>({
  value,
  onValueChange,
  options,
  fill = false,
  size = "default",
  disabled,
  className,
  id,
  ...aria
}: {
  value: T
  onValueChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  fill?: boolean
  /** `sm` (32 px) only inside dense toolbars of tables */
  size?: "default" | "sm"
  disabled?: boolean
  className?: string
  id?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
}) {
  const rich = options.some((o) => o.description)
  const group = (
    <ToggleGroupPrimitive
      id={id}
      data-slot="segmented"
      value={[value]}
      disabled={disabled}
      onValueChange={(next) => {
        const one = options.find((o) => o.value === next[0])
        if (one) onValueChange(one.value)
      }}
      className={cn(
        "inline-flex max-w-full items-stretch gap-0.5 rounded-lg bg-muted p-0.5 ring-1 ring-border ring-inset",
        rich ? "h-auto" : size === "sm" ? "h-8" : "h-9",
        fill ? "flex w-full" : "w-fit",
        // options with descriptions sit side by side only when the container leaves them room (36rem)
        rich && "w-full flex-col @xl/segmented:flex-row",
        className,
      )}
      {...aria}
    >
      {options.map((o) => (
        <TogglePrimitive
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          data-slot="segmented-item"
          className={cn(
            "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none select-none",
            "transition-colors duration-150 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            "aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs dark:aria-pressed:bg-input",
            fill && "flex-1",
            rich && "flex-1 flex-col items-start justify-start gap-0.5 px-3 py-2.5 text-left whitespace-normal",
          )}
        >
          {rich ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                {o.dot ? <span className={cn("size-2 rounded-full", o.dot)} aria-hidden /> : null}
                {o.icon}
                {o.label}
              </span>
              {o.description ? (
                <span className="text-xs font-normal text-muted-foreground text-pretty">{o.description}</span>
              ) : null}
            </>
          ) : (
            <>
              {o.dot ? <span className={cn("size-2 rounded-full", o.dot)} aria-hidden /> : null}
              {o.icon}
              <span className="truncate">{o.label}</span>
            </>
          )}
        </TogglePrimitive>
      ))}
    </ToggleGroupPrimitive>
  )
  return rich ? <div className="@container/segmented w-full">{group}</div> : group
}
