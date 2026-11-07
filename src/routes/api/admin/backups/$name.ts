import { openAsBlob } from "node:fs"
import { createFileRoute } from "@tanstack/react-router"
import { auth } from "@/server/auth"
import { AppError } from "@/server/errors"
import { backupPath } from "@/server/services/backups"
import { loadActor } from "@/server/services/permissions"

/** Download of an encrypted backup (administrators only; the file is delivered as stored, never decrypted). */
export const Route = createFileRoute("/api/admin/backups/$name")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        const actor = session ? loadActor(Number(session.user.id)) : null
        if (!actor?.user.isActive || !actor.isAdmin) return new Response("Not found", { status: 404 })
        let file: string
        try {
          file = backupPath(params.name)
        } catch (err) {
          return new Response(err instanceof AppError ? err.message : "Not found", { status: 404 })
        }
        const body = await openAsBlob(file)
        return new Response(body, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(body.size),
            "Content-Disposition": `attachment; filename="${params.name}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        })
      },
    },
  },
})
