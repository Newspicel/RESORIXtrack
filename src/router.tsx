import { QueryClient } from "@tanstack/react-query"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"
import { getGlobalStartContext } from "@tanstack/react-start"
import { DefaultCatchBoundary } from "@/components/app/error-boundary"
import { NotFound } from "@/components/app/not-found"
import { routerViewTransition } from "@/lib/period-transition"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 },
    },
  })
  const nonce = (getGlobalStartContext() as { nonce?: string } | undefined)?.nonce
  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: NotFound,
    defaultViewTransition: routerViewTransition(),
    ssr: nonce ? { nonce } : undefined,
  })
  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
