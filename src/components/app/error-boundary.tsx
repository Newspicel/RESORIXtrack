import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router"
import { RefreshCw } from "lucide-react"
import { Button, ButtonLink } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { AppError } from "@/server/errors"
import { NotFound } from "./not-found"

export function DefaultCatchBoundary({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const { t, tError } = useI18n()
  // ids outside the viewer's scope answer NotFound: show the same page as an unknown URL
  if (error instanceof AppError && error.status === 404) return <NotFound />
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">{t("errors.generic")}</h1>
      <p className="text-sm text-muted-foreground">{tError(error)}</p>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            reset()
            void router.invalidate()
          }}
        >
          <RefreshCw data-icon="inline-start" />
          {t("common.retry")}
        </Button>
        <ButtonLink variant="ghost" render={<Link to="/" />}>
          {t("nav.dashboard")}
        </ButtonLink>
      </div>
    </div>
  )
}
