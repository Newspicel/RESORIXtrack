/**
 * Setup checklist for administrators (company, holidays, teams, people, schedules, email). Mounted on the
 * dashboard; hides itself when dismissed or complete.
 */

import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Check, ChevronRight, X } from "lucide-react"
import { useId } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import { dismissGettingStartedFn, gettingStartedQuery } from "./api/settings"
import { useAction } from "./ui"

export function GettingStartedCard({ className }: { className?: string }) {
  const me = useMe()
  return me.isAdmin ? <Checklist className={className} /> : null
}

function Checklist({ className }: { className?: string }) {
  const gsTitleId = useId()
  const { t } = useI18n()
  const { data } = useQuery(gettingStartedQuery)
  const dismiss = useAction(() => dismissGettingStartedFn({ data: { dismissed: true } }), {
    invalidate: [["admin", "getting-started"]],
  })
  if (!data || data.dismissed || data.done === data.steps.length) return null
  return (
    <section aria-labelledby={gsTitleId} className={cn("flex flex-col gap-4 rounded-xl border bg-card p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 id={gsTitleId} className="text-base font-semibold">
            {t("admin.getting_started.title")}
          </h2>
          <div className="flex items-center gap-3">
            <Progress value={(data.done / data.steps.length) * 100} className="h-1.5 w-32" />
            <span className="text-xs text-muted-foreground tabular">
              {t("admin.getting_started.progress", { done: data.done, total: data.steps.length })}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => dismiss.mutate(undefined)}
          aria-label={t("admin.getting_started.dismiss")}
          title={t("admin.getting_started.dismiss")}
        >
          <X />
        </Button>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {data.steps.map((s) => (
          <li key={s.key}>
            <Link
              to={s.to}
              className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors duration-150 hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  s.done ? "border-positive bg-positive text-background" : "border-muted-foreground/40",
                )}
                aria-hidden
              >
                {s.done ? <Check className="size-3" /> : null}
              </span>
              <span
                className={cn("flex-1", s.done && "text-muted-foreground line-through decoration-muted-foreground/40")}
              >
                {t(`admin.getting_started.steps.${s.key}`)}
              </span>
              <span className="sr-only">
                {s.done ? t("admin.getting_started.done") : t("admin.getting_started.open")}
              </span>
              {!s.done ? <ChevronRight className="size-4 text-muted-foreground" /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
