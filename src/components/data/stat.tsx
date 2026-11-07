/**
 * Key figure tile (dashboard, accounts, reports). Hierarchy: the value dominates (30px, tabular), the
 * label is a quiet eyebrow, context sits below in muted text. Tint + hairline, no shadow.
 */
import type { ReactNode } from "react"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

export function StatCard({
  label,
  value,
  unit,
  hint,
  progress,
  tone,
  className,
  children,
}: {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  hint?: ReactNode
  /** 0..1 */
  progress?: number
  /** negative: a balance below zero (amber); destructive: legal violations (red, like their badges) */
  tone?: "positive" | "negative" | "destructive" | "default"
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-5", className)}>
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "text-3xl font-semibold tracking-tight tabular",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
        {unit ? <span className="ml-1.5 text-sm font-normal text-muted-foreground">{unit}</span> : null}
      </p>
      {hint ? <p className="text-sm text-muted-foreground text-pretty">{hint}</p> : null}
      {progress != null ? <Progress value={Math.max(0, Math.min(1, progress)) * 100} className="mt-3 h-1.5" /> : null}
      {children}
    </div>
  )
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4", className)}>{children}</div>
}
