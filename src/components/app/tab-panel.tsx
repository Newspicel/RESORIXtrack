import { Activity, type ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { SectionBoundary } from "./section-boundary"

/**
 * A tab panel that stays mounted (`keepMounted`) inside `<Activity>`: switching tabs keeps drafts, table state
 * and scroll, and hidden panels pre-render at low priority so the switch is instant. Inactive panels carry
 * `hidden`, so they are out of the tab order and the accessibility tree. Each panel is its own
 * SectionBoundary: it streams and fails on its own, showing `fallback` while its data loads.
 */
export function TabPanel({
  value,
  active,
  fallback,
  children,
  className,
}: {
  value: string
  active: boolean
  fallback: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <TabsContent value={value} keepMounted className={className}>
      <Activity mode={active ? "visible" : "hidden"}>
        <SectionBoundary fallback={fallback}>{children}</SectionBoundary>
      </Activity>
    </TabsContent>
  )
}

/** Default fallback for a tab panel: a toolbar line and a table-shaped block. */
export function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-busy>
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
