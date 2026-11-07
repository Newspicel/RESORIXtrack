/**
 * Suspense + error boundary for one section of a page. The page streams its shell first; the section shows
 * `fallback` (a skeleton in its shape) until its `useSuspenseQuery` data arrives. A failing section shows an
 * inline retry instead of taking the page down; retry resets the failed queries and renders again.
 */
import { QueryErrorResetBoundary } from "@tanstack/react-query"
import { CatchBoundary } from "@tanstack/react-router"
import { RefreshCw } from "lucide-react"
import { type ReactNode, Suspense } from "react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function SectionBoundary({
  fallback,
  children,
  className,
}: {
  fallback: ReactNode
  children: ReactNode
  /** classes for the inline error */
  className?: string
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset: resetQueries }) => (
        <CatchBoundary
          getResetKey={() => 0}
          errorComponent={({ error, reset }) => (
            <SectionError
              error={error}
              className={className}
              onRetry={() => {
                resetQueries()
                reset()
              }}
            />
          )}
        >
          <Suspense fallback={fallback}>{children}</Suspense>
        </CatchBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}

function SectionError({ error, onRetry, className }: { error: unknown; onRetry: () => void; className?: string }) {
  const { t, tError } = useI18n()
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4 text-sm",
        className,
      )}
    >
      <span className="text-muted-foreground">{tError(error)}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw data-icon="inline-start" />
        {t("common.retry")}
      </Button>
    </div>
  )
}
