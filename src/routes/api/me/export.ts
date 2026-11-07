import { createFileRoute } from "@tanstack/react-router"
import { auth } from "@/server/auth"
import { exportPersonalData } from "@/server/services/privacy"
import { localToday } from "@/server/time"

/** "Download my data" (revDSG Art. 25): everything stored about the signed-in person, as JSON. Session only. */
export const Route = createFileRoute("/api/me/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session)
          return Response.json({ error: { code: "unauthorized", message: "Please sign in" } }, { status: 401 })
        const user = session.user as { id: string | number; timezone?: string }
        const body = JSON.stringify(exportPersonalData(Number(user.id)), null, 2)
        return new Response(body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="resorixtrack-my-data-${localToday(user.timezone ?? "Europe/Zurich")}.json"`,
            "Cache-Control": "no-store",
          },
        })
      },
    },
  },
})
