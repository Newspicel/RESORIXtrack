import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Page } from "@/components/app/page"
import { Skeleton } from "@/components/ui/skeleton"
import { apiDocsQuery } from "@/features/apidocs/api"
import { ApiDocsView } from "@/features/apidocs/docs-page"

/** REST API reference (signed-in people only), rendered from /api/v1/openapi.json's source. */
export const Route = createFileRoute("/api/v1/docs")({
  beforeLoad: ({ context, location }) => {
    if (!context.bootstrap.me) throw redirect({ to: "/login", search: { next: location.href } })
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(apiDocsQuery),
  head: () => ({ meta: [{ title: "API · RESORIXtrack" }] }),
  pendingComponent: () => (
    <Page>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-96 w-full" />
    </Page>
  ),
  component: function ApiDocsRoute() {
    const { data } = useSuspenseQuery(apiDocsQuery)
    return <ApiDocsView doc={data} />
  },
})
