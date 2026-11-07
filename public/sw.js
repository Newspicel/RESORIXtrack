// RESORIXtrack service worker: lets the installed app start offline so the clock can queue punches.
// - /assets/* (hashed, immutable): cache first.
// - Page navigations: network first; the last good copy of each page is the offline fallback.
// - Server functions, the REST API, auth and attachments are never cached.
// Signing out (a navigation that lands on /login) clears the cached pages.
const VERSION = "v1"
const ASSETS = `rt-assets-${VERSION}`
const PAGES = `rt-pages-${VERSION}`
const STATIC = ["/manifest.webmanifest", "/favicon.svg", "/apple-touch-icon.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const assets = await caches.open(ASSETS)
      await assets.addAll(STATIC).catch(() => {})
      try {
        const res = await fetch("/", { credentials: "same-origin" })
        if (res.ok && !new URL(res.url).pathname.startsWith("/login")) {
          const html = await res.clone().text()
          await (await caches.open(PAGES)).put("/", res)
          const urls = [...new Set(html.match(/\/assets\/[\w./-]+/g) ?? [])]
          await assets.addAll(urls).catch(() => {})
        }
      } catch {
        // offline during install: pages are cached on the next visit
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const stale = (await caches.keys()).filter((key) => ![ASSETS, PAGES].includes(key))
      await Promise.all(stale.map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

const NEVER = ["/_serverFn", "/api/", "/branding/", "/sw.js"]

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || NEVER.some((p) => url.pathname.startsWith(p))) return

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) void cache.put(req, res.clone())
        return res
      }),
    )
    return
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const pages = await caches.open(PAGES)
        try {
          const res = await fetch(req)
          const landed = new URL(res.url).pathname
          if (landed.startsWith("/login") || landed.startsWith("/setup")) {
            await Promise.all((await pages.keys()).map((key) => pages.delete(key)))
          } else if (res.ok && res.type === "basic" && !res.redirected) {
            await pages.put(url.pathname, res.clone())
          }
          return res
        } catch (err) {
          const hit = (await pages.match(url.pathname)) ?? (await pages.match("/"))
          if (hit) return hit
          throw err
        }
      })(),
    )
    return
  }

  if (STATIC.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)))
  }
})
