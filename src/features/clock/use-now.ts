/**
 * One shared 1-second ticker for live timers. It runs only while something subscribes and the page is
 * visible, so hidden tabs do no work; only the small components that read it re-render.
 */
import { useSyncExternalStore } from "react"

let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null
const subs = new Set<() => void>()

function tick() {
  now = Date.now()
  for (const s of subs) s()
}

function sync() {
  const run = subs.size > 0 && document.visibilityState === "visible"
  if (run && !timer) {
    tick()
    timer = setInterval(tick, 1000)
  } else if (!run && timer) {
    clearInterval(timer)
    timer = null
  }
}

function subscribe(cb: () => void) {
  subs.add(cb)
  if (subs.size === 1) document.addEventListener("visibilitychange", sync)
  sync()
  return () => {
    subs.delete(cb)
    if (subs.size === 0) document.removeEventListener("visibilitychange", sync)
    sync()
  }
}

/**
 * Current time in ms, updated every second while `live` (otherwise a stable snapshot). During SSR and
 * hydration it is 0, so timers render the server's figures first and start ticking after hydration.
 */
export function useNow(live = true): number {
  return useSyncExternalStore(
    live ? subscribe : noop,
    () => now,
    () => 0,
  )
}

const noop = () => () => {}
