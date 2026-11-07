/**
 * "Clock in/out at a chosen time": a small popover with a time input. A time later than now means the
 * previous day (forgot to clock out last night). The server marks such entries as manual.
 */
import { History } from "lucide-react"
import { type ReactElement, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { addDaysStr } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { ClockStateName } from "@/server/services/clock"
import { minutesOfDay, todayIn, wallClock, wallToInstant } from "../time/lib"
import { TimeInput } from "../time/time-input"

export function CustomTimeButton({
  state,
  onSubmit,
  size = "icon-sm",
  trigger,
}: {
  state: ClockStateName
  onSubmit: (at: string) => void
  size?: "icon-sm" | "icon" | "icon-lg"
  trigger?: ReactElement
}) {
  const clockCustomTimeId = useId()
  const t = useT()
  const me = useMe()
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState("")
  const [error, setError] = useState(false)
  const dir = state === "idle" ? "in" : "out"
  const label = t(`clock.custom_time_${dir}`)

  const submit = () => {
    if (!time) {
      setError(true)
      return
    }
    const tz = me.timezone
    const today = todayIn(tz)
    const date =
      minutesOfDay(Date.now(), tz) < Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
        ? addDaysStr(today, -1)
        : today
    onSubmit(wallToInstant(date, time, tz))
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setTime(wallClock(Date.now(), me.timezone).time)
          setError(false)
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                trigger ?? (
                  <Button variant="ghost" size={size} aria-label={label}>
                    <History />
                  </Button>
                )
              }
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 shadow-overlay">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field data-invalid={error || undefined}>
            <FieldLabel htmlFor={clockCustomTimeId}>{t(`clock.custom_time_label_${dir}`)}</FieldLabel>
            <TimeInput
              id={clockCustomTimeId}
              value={time}
              onChange={(v) => {
                setTime(v)
                setError(false)
              }}
              aria-invalid={error || undefined}
            />
            <FieldDescription>{t(`clock.custom_time_help_${dir}`)}</FieldDescription>
          </Field>
          <Button type="submit">{t(dir === "in" ? "clock.start" : "clock.stop")}</Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
