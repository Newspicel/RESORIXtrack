import type { Page } from "@playwright/test"
import { expect, hydrated, PAGES, test } from "./fixtures"

declare global {
  interface Window {
    cspViolations: string[]
  }
}

/** Collects console errors, hydration warnings, page errors and CSP violations. */
function watch(page: Page) {
  const problems: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error" || /hydrat/i.test(m.text())) problems.push(`console.${m.type()}: ${m.text()}`)
  })
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`))
  return problems
}

test.describe("page structure", () => {
  for (const [who, path] of PAGES) {
    test(`${path}${who ? ` (${who})` : ""}`, async ({ as, page: anonymous }) => {
      const page = who ? await as(who) : anonymous
      const problems = watch(page)
      await page.addInitScript(() => {
        window.cspViolations = []
        document.addEventListener("securitypolicyviolation", (e) =>
          window.cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
        )
      })
      const res = await page.goto(path)
      expect(res?.status()).toBe(200)
      await hydrated(page)
      await page.waitForLoadState("networkidle")
      expect(new URL(page.url()).pathname, "no redirect").toBe(path)

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
      await expect(page.getByRole("main")).toHaveCount(1)
      // interactive elements never nest (invalid HTML, broken for assistive technology)
      expect(await page.locator("button button, button a, a button, a a").count()).toBe(0)
      // every form control has an accessible name
      const unnamed = await page
        .locator("input:not([type=hidden]), select, textarea, button, [role=combobox], [role=switch]")
        .evaluateAll((els) =>
          els
            .filter((el) => el.getClientRects().length > 0 && !el.closest("[aria-hidden=true]"))
            .filter((el) => {
              const label =
                el.getAttribute("aria-label") ||
                el.getAttribute("aria-labelledby") ||
                el.getAttribute("title") ||
                ((el instanceof HTMLInputElement ||
                  el instanceof HTMLButtonElement ||
                  el instanceof HTMLSelectElement ||
                  el instanceof HTMLTextAreaElement) &&
                  (el.labels?.length ?? 0) > 0) ||
                el.textContent?.trim()
              return !label
            })
            .map((el) => el.outerHTML.slice(0, 120)),
        )
      expect(unnamed, "controls without a name").toEqual([])

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, "horizontal overflow (px)").toBeLessThanOrEqual(0)

      expect(await page.evaluate(() => window.cspViolations)).toEqual([])
      expect(problems).toEqual([])
    })
  }
})
