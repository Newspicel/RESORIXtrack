/**
 * Production HTTP server: static client assets (hashed files cached forever) + the TanStack Start handler.
 * Run after `pnpm build`: `node server.mjs` (PORT, HOST from the environment).
 */
import { serve } from "srvx"
import { staticMiddleware } from "srvx/static"
import app from "./dist/server/server.js"

const assets = staticMiddleware({ dir: "dist/client", maxAge: 31536000, immutable: true })
const publicFiles = staticMiddleware({ dir: "dist/client", maxAge: 3600 })

serve({
  port: Number(process.env.PORT ?? 8080),
  hostname: process.env.HOST ?? "0.0.0.0",
  middleware: [
    (req, next) => (new URL(req.url).pathname.startsWith("/assets/") ? assets(req, next) : publicFiles(req, next)),
  ],
  fetch: (req) => app.fetch(req),
  gracefulShutdown: true,
})
