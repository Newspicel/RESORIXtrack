/** Whole-hour axis for durations in minutes: a 0..top domain and ticks every 2 h (4 h, 8 h … for long spans). */
export function hourAxis(maxMinutes: number, minTop = 8 * 60): { domain: [number, number]; ticks: number[] } {
  const raw = Math.max(minTop, maxMinutes)
  const step = raw <= 12 * 60 ? 120 : raw <= 24 * 60 ? 240 : Math.ceil(raw / 6 / 480) * 480
  const top = Math.ceil(raw / step) * step
  return { domain: [0, top], ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) }
}

/** Tick values on whole hours (1, 2, 5, 10 … h steps) covering [lo, hi] minutes, at most ~6 ticks. */
export function hourTicks(lo: number, hi: number): number[] {
  const span = Math.max(1, (hi - lo) / 60)
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((h) => span / h <= 6) ?? 1000
  const out: number[] = []
  for (let h = Math.floor(lo / 60 / step) * step; h <= Math.ceil(hi / 60 / step) * step; h += step) out.push(h * 60)
  return out
}
