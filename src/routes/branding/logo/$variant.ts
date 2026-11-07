import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { createFileRoute } from "@tanstack/react-router"
import { env } from "@/server/env"

const TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" }

/** Company logo for dark/light backgrounds: the uploaded file (Settings → Branding) or the bundled default. */
export const Route = createFileRoute("/branding/logo/$variant")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const variant = params.variant === "light" ? "light" : "dark"
        for (const ext of Object.keys(TYPES)) {
          const file = path.join(env.brandingDir, `logo-${variant}${ext}`)
          if (existsSync(file)) {
            return new Response(readFileSync(file), {
              headers: {
                "Content-Type": TYPES[ext],
                "Cache-Control": "public, max-age=300",
                // uploaded SVGs are served sandboxed: no scripts even if someone opens the URL directly
                "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
              },
            })
          }
        }
        return new Response(null, { status: 302, headers: { Location: `/brand/resorix-logo-on-${variant}.svg` } })
      },
    },
  },
})
