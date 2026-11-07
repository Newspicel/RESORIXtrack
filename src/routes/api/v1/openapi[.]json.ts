import { createFileRoute } from "@tanstack/react-router"
import { auth } from "@/server/auth"
import { env } from "@/server/env"
import { authenticate } from "@/server/rest/auth"
import { openApiDocument } from "@/server/rest/openapi"
import { errorResponse } from "@/server/rest/router"
import { loadActor } from "@/server/services/permissions"

/** OpenAPI 3.1 document of the REST API: for signed-in people or a valid API key. */
export const Route = createFileRoute("/api/v1/openapi.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await auth.api.getSession({ headers: request.headers })
          if (!session || !loadActor(Number(session.user.id)).user.isActive) await authenticate(request)
          return Response.json(openApiDocument(env.baseUrl), { headers: { "Cache-Control": "no-store" } })
        } catch (err) {
          return errorResponse(err)
        }
      },
    },
  },
})
