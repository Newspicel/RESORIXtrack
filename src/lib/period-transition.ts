/**
 * Directional view transitions for period navigation (week, month, year).
 *
 * Two update paths share one set of transition types and one CSS animation (styles.css):
 * - Local state (`setYear`): React runs the change as a Transition tagged with `addTransitionType`, and the
 *   `<PeriodContent>` boundary animates once the new period has rendered (suspending data keeps the old one).
 * - URL search params: TanStack Router commits matches through external stores, which React renders
 *   synchronously, so React's `<ViewTransition>` never sees a Transition. The router starts the native view
 *   transition itself after the loader has the new period; `routerViewTransition` hands it the same type.
 */
import type { AnyRouter } from "@tanstack/react-router"
import { addTransitionType, startTransition, type TransitionStartFunction } from "react"

type ViewTransitionOptions = Exclude<AnyRouter["options"]["defaultViewTransition"], boolean | undefined>

export type PeriodStep = "forward" | "back" | "jump"

export const PERIOD_TYPES = {
  forward: "period-forward",
  back: "period-back",
  jump: "period-jump",
} as const satisfies Record<PeriodStep, string>

let pending: { href: string; type: string } | null = null

/**
 * Runs `change` (a state update or a router navigation) as a period step in direction `step`. `from` is the
 * clicked control: the first PeriodContent after it is the one that slides. Pass the `start` of a
 * `useTransition` to show the pending state while the next period loads.
 */
export function stepPeriod(
  router: AnyRouter,
  step: PeriodStep,
  change: () => void,
  { from, start = startTransition }: { from?: Element; start?: TransitionStartFunction } = {},
) {
  markTarget(from)
  const before = router.latestLocation.href
  start(() => {
    addTransitionType(PERIOD_TYPES[step])
    change()
  })
  const after = router.latestLocation.href
  pending = after === before ? null : { href: after, type: PERIOD_TYPES[step] }
}

// A page can show several periods (team overview: members and calendar); only the stepped one may take the
// shared transition name, two elements with one name would cancel the transition.
function markTarget(from: Element | undefined) {
  for (const el of document.querySelectorAll("[data-period-target]")) el.removeAttribute("data-period-target")
  if (!from) return
  const target = [...document.querySelectorAll("[data-period-view]")].find(
    (el) => from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && el.checkVisibility(),
  )
  target?.setAttribute("data-period-target", "")
}

/**
 * True while the router loads a location reached by a period step. A loader awaits the next period then, so
 * the slide shows it; other changes of the same page commit at once and their result follows (deferred).
 */
export function isPeriodStep(location: { href: string }): boolean {
  return pending?.href === location.href
}

/** Router option: animate only navigations started by `stepPeriod`, everything else commits without one. */
export function routerViewTransition(): ViewTransitionOptions | undefined {
  if (typeof document === "undefined" || !CSS.supports("selector(:active-view-transition-type(a))")) return undefined
  return {
    types: ({ toLocation }) => {
      const p = pending
      pending = null
      return p?.href === toLocation.href ? [p.type] : false
    },
  }
}
