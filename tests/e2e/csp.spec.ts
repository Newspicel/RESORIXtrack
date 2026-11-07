import { request as playwrightRequest } from "@playwright/test"
import { expect, PAGES, statePath, test } from "./fixtures"

// The policy is per response, so a plain HTTP client is enough (desktop project only, see playwright.config.ts).
// Runtime violations in the browser are caught by pages.spec.ts.
test.describe("content security policy", () => {
  for (const [who, path] of PAGES) {
    test(`${path} carries a nonce CSP`, async ({ baseURL }) => {
      const api = await playwrightRequest.newContext({ baseURL, storageState: who ? statePath(who) : undefined })
      const res = await api.get(path, { maxRedirects: 0 })
      expect(res.status()).toBe(200)
      const csp = res.headers()["content-security-policy"] ?? ""
      const nonce = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1]
      expect(nonce, csp).toBeTruthy()
      const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? ""
      expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval/)
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("frame-ancestors 'none'")
      expect(csp).toContain("base-uri 'self'")

      const html = await res.text()
      const inline = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((attrs) => !/\bsrc=/.test(attrs))
      expect(inline.length).toBeGreaterThan(0)
      for (const attrs of inline) expect(attrs).toContain(`nonce="${nonce}"`)
      await api.dispose()
    })
  }
})
