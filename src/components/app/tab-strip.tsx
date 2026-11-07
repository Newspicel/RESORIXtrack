import type { ReactNode } from "react"

/**
 * Horizontal strip for a tab list that may not fit on small screens: scrolls sideways without a visible
 * scrollbar and never vertically (the active underline overhangs the list by a pixel).
 */
export function TabStrip({ children }: { children: ReactNode }) {
  return <div className="no-scrollbar -mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">{children}</div>
}
