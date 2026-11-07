/**
 * "Clock in/out at a chosen time": a small popover with a time input. The server marks such entries as
 * manual. A time later than now means the previous day (forgot to clock out last night), except a clock-out
 * within 24 h of the clock-in: that is "clock out later", the server closes the entry then.
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
import { todayIn, wallClock, wallToInstant } from "../time/lib"
import { TimeInput } from "../time/time-input"
import { useNow } from "./use-now"

const MAX_ENTRY_MS = 24 * 3600_000

/** The instant a chosen wall-clock time stands for (see the module comment). */
export function customInstant(time: string, tz: string, now: number, since: string | null): string {
  const today = todayIn(tz)
  const at = wallToInstant(today, time, tz)
  if (Date.parse(at) <= now) return at
  if (since && Date.parse(at) - Date.parse(since) <= MAX_ENTRY_MS) return at
  return wallToInstant(addDaysStr(today, -1), time, tz)
}

export function CustomTimeButton({
  state,
  since,
  onSubmit,
  size = "icon-sm",
  trigger,
}: {
  state: ClockStateName
  /** Start of the running entry. */
  since: string | null
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
    onSubmit(customInstant(time, me.timezone, Date.now(), dir === "out" ? since : null))
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
          <SubmitButton dir={dir} time={time} since={since} />
        </form>
      </PopoverContent>
    </Popover>
  )
}

function SubmitButton({ dir, time, since }: { dir: "in" | "out"; time: string; since: string | null }) {
  const t = useT()
  const me = useMe()
  const now = useNow(dir === "out")
  const later =
    dir === "out" && /^\d{2}:\d{2}$/.test(time) && Date.parse(customInstant(time, me.timezone, now, since)) > now
  return <Button type="submit">{t(dir === "in" ? "clock.start" : later ? "clock.stop_later" : "clock.stop")}</Button>
}
