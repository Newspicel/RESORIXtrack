import { fmtMinutes } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * A duration in h:mm. With `balance`, positive/negative get their status colour – the explicit +/−
 * sign always carries the meaning too (colour is never the only signal).
 */
export function Duration({
  minutes,
  balance,
  className,
}: {
  minutes: number | null | undefined
  balance?: boolean
  className?: string
}) {
  const tone =
    balance && minutes != null ? (minutes > 0 ? "text-positive" : minutes < 0 ? "text-negative" : undefined) : undefined
  return <span className={cn("tabular", tone, className)}>{fmtMinutes(minutes, { sign: balance })}</span>
}

/** Muted "+ h:mm today" beside totals of complete days while today is still in progress. */
export function TodayHint({ minutes, className }: { minutes: number | null | undefined; className?: string }) {
  const t = useT()
  if (!minutes || minutes <= 0) return null
  return (
    <span className={cn("text-xs font-normal whitespace-nowrap text-muted-foreground tabular", className)}>
      {t("common.plus_today", { time: fmtMinutes(minutes) })}
    </span>
  )
}

/** Stands in for today's difference: the day is not over yet. */
export function InProgress({ className }: { className?: string }) {
  const t = useT()
  return <span className={cn("text-xs text-muted-foreground", className)}>{t("common.in_progress")}</span>
}
