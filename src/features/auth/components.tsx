import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useT } from "@/lib/i18n"
import { authConfigQuery } from "./api"

/** The one card of a signed-out page: a title, an optional one-liner, the content. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 tabIndex={-1} data-page-heading className="text-lg font-semibold outline-none">
            {title}
          </h1>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** The source code link (AGPL section 13) and the privacy notice. */
export function AuthFooter() {
  const t = useT()
  const { data } = useQuery(authConfigQuery)
  return (
    <p className="mt-6 flex flex-wrap justify-center gap-x-3 gap-y-1 text-center text-xs text-muted-foreground">
      <a
        href={data?.sourceUrl ?? "https://github.com/RESORIX-AG/RESORIXtrack"}
        rel="noopener"
        className="underline-offset-4 hover:underline"
      >
        {t("auth.source_code")}
      </a>
      <Link to="/privacy" className="underline-offset-4 hover:underline">
        {t("auth.privacy")}
      </Link>
    </p>
  )
}
