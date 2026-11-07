import { createFileRoute } from "@tanstack/react-router"
import { eq, sql } from "drizzle-orm"
import { db } from "@/server/db"
import { appState } from "@/server/db/schema"

/** Liveness for Docker/Caddy: database reachable; reports the worker heartbeat age (seconds) for monitoring. */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => {
        try {
          db.run(sql`select 1`)
          const beat = db.select().from(appState).where(eq(appState.key, "worker_heartbeat")).get()
          const workerAge = beat ? Math.round((Date.now() - Date.parse(beat.value)) / 1000) : null
          return Response.json(
            { status: "ok", workerAgeSeconds: workerAge },
            { headers: { "Cache-Control": "no-store" } },
          )
        } catch {
          return Response.json({ status: "error" }, { status: 503 })
        }
      },
    },
  },
})
