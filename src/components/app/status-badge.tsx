/**
 * Status chip: colour + icon + text (never colour alone). All tones share one lightness (tokens).
 */
import { AlertTriangle, Ban, Check, CircleDot, Clock3, Info, Lock, X } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type Tone = "neutral" | "info" | "positive" | "warning" | "negative" | "brand" | "absent"
const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/12 text-info",
  positive: "bg-positive/12 text-positive",
  warning: "bg-warning/14 text-warning",
  negative: "bg-destructive/12 text-destructive",
  brand: "bg-brand-soft text-primary",
  absent: "bg-absent/14 text-absent",
}
const ICONS = {
  pending: Clock3,
  approved: Check,
  rejected: X,
  cancelled: Ban,
  signed: Lock,
  warning: AlertTriangle,
  info: Info,
  dot: CircleDot,
}

export function StatusBadge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone
  icon?: keyof typeof ICONS | null
  children: ReactNode
  className?: string
}) {
  const Icon = icon ? ICONS[icon] : null
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </span>
  )
}

/** Absence request states. */
export function AbsenceStatusBadge({
  status,
  label,
}: {
  status: "pending" | "approved" | "rejected" | "cancelled"
  label: string
}) {
  const tone: Tone =
    status === "approved"
      ? "positive"
      : status === "pending"
        ? "warning"
        : status === "rejected"
          ? "negative"
          : "neutral"
  return (
    <StatusBadge tone={tone} icon={status}>
      {label}
    </StatusBadge>
  )
}

/** Coloured dot for categories (absence types, projects, teams) – always next to a text label. */
export function ColorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ background: color }}
      aria-hidden
    />
  )
}
