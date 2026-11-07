import type { Locator, Page } from "@playwright/test"
import { expect, goto, test } from "./fixtures"

/** In-page navigation (filters, tabs, periods, toggles) keeps the scroll position. */
async function keepsScroll(page: Page, control: Locator, act: () => Promise<void>) {
  // a short window, so the page scrolls and the control is in view below the top
  await page.setViewportSize({ width: 1280, height: 420 })
  // scroll the page so the control sits just below the top edge
  await control.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80))
  const before = await page.evaluate(() => window.scrollY)
  expect(before).toBeGreaterThan(0)
  const url = page.url()
  await act()
  await expect.poll(() => page.url()).not.toBe(url)
  // the new content has rendered; the window must not have moved
  await page.waitForLoadState("networkidle")
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2)
}

test.describe("scroll position", () => {
  test.skip(({ isMobile }) => isMobile, "desktop layout")

  test("My time: show deleted and a period step", async ({ as }) => {
    const page = await as("mia")
    await goto(page, "/time")
    const deleted = page.getByRole("switch", { name: "Show deleted" })
    await keepsScroll(page, deleted, () => deleted.click())
    const previous = page.getByRole("button", { name: "Previous" }).first()
    await keepsScroll(page, previous, () => previous.click())
  })

  test("admin settings: tab switch", async ({ as }) => {
    const page = await as("admin")
    await goto(page, "/admin/settings?tab=time")
    const tab = page.getByRole("tab", { name: "Swiss law" })
    await keepsScroll(page, tab, () => tab.click())
  })
})
