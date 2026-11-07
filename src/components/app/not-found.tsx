import { Link } from "@tanstack/react-router"
import { ButtonLink } from "@/components/ui/button"
import { useT } from "@/lib/i18n"

export function NotFound() {
  const t = useT()
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium tabular text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">{t("common.not_found")}</h1>
      <ButtonLink variant="outline" render={<Link to="/" />}>
        {t("nav.dashboard")}
      </ButtonLink>
    </div>
  )
}
