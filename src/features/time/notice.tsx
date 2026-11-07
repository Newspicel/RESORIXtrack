import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

const TONES = {
  neutral: "bg-muted/60 text-foreground [&>svg]:text-muted-foreground",
  warning: "bg-warning/10 text-foreground [&>svg]:text-warning",
  positive: "bg-positive/10 text-foreground [&>svg]:text-positive",
  info: "bg-info/10 text-foreground [&>svg]:text-info",
} as const

/** A one-line inline notice (tint, no border): locks, corrections, reminders. */
export function Notice({
  icon: Icon,
  tone = "neutral",
  children,
  action,
  className,
}: {
  icon: LucideIcon
  tone?: keyof typeof TONES
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm", TONES[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-pretty">{children}</div>
      {action ? <div className="-my-1 shrink-0">{action}</div> : null}
    </div>
  )
}
