/**
 * Clock in / break / clock out control: a compact pill in the desktop top bar and a sticky bar above the
 * tab bar on phones. One primary action per state; break and "custom time" are secondary. Keyboard: S
 * clocks in/out, B starts/ends a break (only when no input has focus). Offline clicks queue and show as
 * pending until they are synced.
 */
import { CloudOff, Coffee, Play, Square } from "lucide-react"
import { type ReactElement, useEffect, useEffectEvent } from "react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fmtMinutes } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { ClockAction, ClockStateName } from "@/server/services/clock"
import { CustomTimeButton } from "./custom-time"
import { registerServiceWorker } from "./register-sw"
import { type LiveClock, liveSinceSec, liveWorkedMin, primaryAction, useClock } from "./use-clock"
import { useNow } from "./use-now"

export type Clock = ReturnType<typeof useClock>

export function ClockControl({ variant }: { variant: "topbar" | "bar" }) {
  const clock = useClock()
  if (variant === "topbar") return <TopbarClock clock={clock} />
  return <MobileClockBar clock={clock} />
}

const STATE_DOT: Record<ClockStateName, string> = {
  idle: "bg-faint-foreground",
  working: "bg-work",
  on_break: "bg-break",
}

/** h:mm for the bars: today's work while working or idle, the running break while on a break. */
function LiveFigure({ c, className }: { c: LiveClock; className?: string }) {
  const now = useNow(c.state !== "idle")
  const min = c.state === "on_break" ? liveSinceSec(c, now) / 60 : liveWorkedMin(c, now)
  return (
    <span className={cn("tabular", className)} suppressHydrationWarning>
      {fmtMinutes(Math.floor(min))}
    </span>
  )
}

const ACTION_ICON: Record<ClockAction, typeof Play> = { start: Play, resume: Play, stop: Square, break: Coffee }

/** S: clock in/out, B: start/end a break. Ignored while typing or while an overlay is open. */
function useShortcuts(clock: Clock) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const state = clock.data?.state
    if (!state || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
    const el = e.target
    if (el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)))
      return
    if (document.querySelector("[role=dialog],[role=alertdialog],[role=menu]")) return
    const key = e.key.toLowerCase()
    if (key === "s") {
      e.preventDefault()
      void clock.act(state === "idle" ? "start" : "stop")
    } else if (key === "b" && state !== "idle") {
      e.preventDefault()
      void clock.act(state === "working" ? "break" : "resume")
    }
  })
  useEffect(() => {
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

function ShortcutTip({ label, keyName, children }: { label: string; keyName?: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className="flex items-center gap-2">
        {label}
        {keyName ? <Kbd>{keyName}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** Primary and secondary actions for the current state (both bars and the dashboard card). */
export function ClockActions({
  clock,
  size = "sm",
  labels = true,
  custom = true,
  className,
}: {
  clock: Clock
  size?: "sm" | "default" | "lg"
  labels?: boolean
  custom?: boolean
  className?: string
}) {
  const t = useT()
  const c = clock.data
  if (!c) return null
  const primary = primaryAction(c.state)
  const PrimaryIcon = ACTION_ICON[primary]
  const iconSize = size === "lg" ? "icon-lg" : size === "default" ? "icon" : "icon-sm"
  const primaryLabel = t(`clock.${primary}`)
  const secondary: ClockAction | null = c.state === "working" ? "break" : c.state === "on_break" ? "stop" : null
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {custom ? (
        <CustomTimeButton
          state={c.state}
          size={iconSize}
          onSubmit={(at) => void clock.act(c.state === "idle" ? "start" : "stop", { at, custom: true })}
        />
      ) : null}
      {secondary ? (
        <ShortcutTip label={t(`clock.${secondary}`)} keyName={secondary === "break" ? "B" : "S"}>
          {size === "lg" && labels ? (
            <Button variant="outline" size="lg" onClick={() => void clock.act(secondary)}>
              {secondary === "break" ? (
                <Coffee data-icon="inline-start" />
              ) : (
                <Square data-icon="inline-start" className="fill-current" />
              )}
              {t(`clock.${secondary}`)}
            </Button>
          ) : (
            <Button
              variant="outline"
              size={iconSize}
              aria-label={t(`clock.${secondary}`)}
              onClick={() => void clock.act(secondary)}
            >
              {secondary === "break" ? <Coffee /> : <Square className="fill-current" />}
            </Button>
          )}
        </ShortcutTip>
      ) : null}
      <ShortcutTip label={primaryLabel} keyName={primary === "resume" ? "B" : "S"}>
        <Button
          size={labels ? size : iconSize}
          aria-label={labels ? undefined : primaryLabel}
          onClick={() => void clock.act(primary)}
          className={cn(labels && size !== "lg" && "min-w-24", labels && size === "lg" && "min-w-36 px-4")}
        >
          <PrimaryIcon data-icon="inline-start" className={primary === "stop" ? "fill-current" : undefined} />
          {labels ? primaryLabel : null}
        </Button>
      </ShortcutTip>
    </div>
  )
}

export function OfflineBadge({ clock, compact }: { clock: Clock; compact?: boolean }) {
  const t = useT()
  if (clock.online && !clock.pending) return null
  const text = clock.pending ? t("clock.pending", { count: clock.pending }) : t("clock.offline")
  return (
    <output
      className="inline-flex h-5 items-center gap-1 rounded-md bg-warning/14 px-1.5 text-xs font-medium text-warning"
      title={compact ? text : undefined}
    >
      <CloudOff className="size-3.5" aria-hidden />
      {compact ? (
        <>
          {clock.pending ? <span className="tabular">{clock.pending}</span> : null}
          <span className="sr-only">{text}</span>
        </>
      ) : (
        text
      )}
    </output>
  )
}

function TopbarClock({ clock }: { clock: Clock }) {
  const t = useT()
  useShortcuts(clock)
  useEffect(registerServiceWorker, [])
  const c = clock.data
  if (!c) return <Skeleton className="h-9 w-52 rounded-lg" />
  return (
    <fieldset
      className="m-0 flex h-9 min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3"
      aria-label={t("clock.label")}
    >
      <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT[c.state])} aria-hidden />
      <LiveFigure c={c} className="text-sm font-semibold" />
      <span className="hidden text-xs text-muted-foreground xl:inline">{t(`clock.state.${c.state}`)}</span>
      <span className="sr-only xl:hidden">{t(`clock.state.${c.state}`)}</span>
      <OfflineBadge clock={clock} compact />
      <ClockActions clock={clock} className="[&_[data-slot=button]]:rounded-sm" />
    </fieldset>
  )
}

function MobileClockBar({ clock }: { clock: Clock }) {
  const t = useT()
  const c = clock.data
  if (!c) return <Skeleton className="h-14 w-full rounded-xl" />
  return (
    <fieldset
      className="flex h-14 items-center gap-3 rounded-xl border bg-card/95 pr-2 pl-4 shadow-overlay backdrop-blur m-0 min-w-0"
      aria-label={t("clock.label")}
    >
      <span className={cn("size-2.5 shrink-0 rounded-full", STATE_DOT[c.state])} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <LiveFigure c={c} className="text-base font-semibold" />
        <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {t(`clock.state.${c.state}`)}
          <OfflineBadge clock={clock} compact />
        </span>
      </div>
      <ClockActions clock={clock} size="default" />
    </fieldset>
  )
}
