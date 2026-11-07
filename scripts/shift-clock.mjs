/**
 * Preload for scripts/screenshots.ts: shifts Date and Temporal.Now to SHIFT_CLOCK_TO (an ISO instant) while
 * time keeps running, so the seed and the server agree on a weekday morning whenever the screenshots are taken.
 *   NODE_OPTIONS="--import ./scripts/shift-clock.mjs" SHIFT_CLOCK_TO=2026-11-05T09:42:00Z node server.mjs
 */
const target = process.env.SHIFT_CLOCK_TO
const zone = (tz) => tz ?? Temporal.Now.timeZoneId()
if (target) {
  const RealDate = Date
  const offset = RealDate.parse(target) - RealDate.now()
  const now = () => RealDate.now() + offset

  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now())
      else super(...args)
    }
    static now() {
      return now()
    }
  }
  globalThis.Date = ShiftedDate

  const instant = () => Temporal.Instant.fromEpochMilliseconds(now())
  const zoned = (tz) => instant().toZonedDateTimeISO(zone(tz))
  Object.assign(Temporal.Now, {
    instant,
    zonedDateTimeISO: zoned,
    plainDateTimeISO: (tz) => zoned(tz).toPlainDateTime(),
    plainDateISO: (tz) => zoned(tz).toPlainDate(),
    plainTimeISO: (tz) => zoned(tz).toPlainTime(),
  })
}
