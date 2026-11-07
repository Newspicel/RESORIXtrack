import { createFileRoute } from "@tanstack/react-router"
import { handleRest } from "@/server/rest/router"

/** REST API v1 for API keys (see src/server/rest). */
export const Route = createFileRoute("/api/v1/$")({
  server: { handlers: { ANY: ({ request }) => handleRest(request) } },
})
