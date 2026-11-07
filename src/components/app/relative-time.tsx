import { fmtDateTime, relativeTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"

/**
 * "3 minutes ago" with the exact time as tooltip. Server and browser render at different moments, so the
 * text may differ by a few seconds: hydration accepts that for this element only.
 */
export function RelativeTime({ at, tz }: { at: string; tz?: string }) {
  const { intl } = useI18n()
  return (
    <time dateTime={at} title={fmtDateTime(at, { intl, tz: tz ?? "UTC" })} suppressHydrationWarning>
      {relativeTime(at, intl)}
    </time>
  )
}
