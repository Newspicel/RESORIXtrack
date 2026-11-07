import type { Page, TestInfo } from "@playwright/test"
import { expect, goto, isMobile, rows, test } from "./fixtures"

/** Opens a page through the navigation (the "More" sheet on phones). */
async function navigateTo(page: Page, info: TestInfo, name: string) {
  if (isMobile(info)) await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("link", { name, exact: true }).click()
}

test("employee: public holidays page is read-only and shows the applicable calendar", async ({ as }, info) => {
  const page = await as("mia")
  await goto(page, "/")
  await navigateTo(page, info, "Public holidays")
  await expect(page).toHaveURL(/\/holidays$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Public holidays")
  // the demo company's default calendar applies to everyone
  await expect(page.getByRole("heading", { level: 2, name: "CH-FR City of Fribourg" })).toBeVisible()
  await expect(page.getByText("company default")).toBeVisible()
  const year = String(new Date().getFullYear())
  await expect(page.getByRole("tab", { name: year })).toHaveAttribute("aria-selected", "true")
  await expect(rows(page).filter({ hasText: "Swiss National Day" })).toHaveCount(1)
  await expect(rows(page).filter({ hasText: "Christmas Day" })).toContainText("Full day")
  // read-only: nothing to import, add, edit or delete; no link to the administration for employees
  await expect(page.getByRole("button", { name: /import|add holiday|edit|delete/i })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Manage calendars" })).toHaveCount(0)
  // next year is a tab too and keeps the page in place
  await page.getByRole("tab", { name: String(Number(year) + 1) }).click()
  await expect(page).toHaveURL(new RegExp(`year=${Number(year) + 1}`))
  await expect(rows(page).filter({ hasText: "Swiss National Day" })).toHaveCount(1)
})

test("admin: the menu says Holiday calendars and Public holidays links to the administration", async ({ as }, info) => {
  const page = await as("admin")
  await goto(page, "/")
  await navigateTo(page, info, "Holiday calendars")
  await expect(page).toHaveURL(/\/admin\/holidays$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Holiday calendars")
  await goto(page, "/holidays")
  await page.getByRole("link", { name: "Manage calendars" }).click()
  await expect(page).toHaveURL(/\/admin\/holidays$/)
})
