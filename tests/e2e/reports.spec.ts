import type { Page } from "@playwright/test"
import { expect, goto, test } from "./fixtures"

async function download(page: Page, kind: string, format: "PDF" | "XLSX" | "CSV") {
  const [response, file] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/reports/${kind}?`) && r.url().includes(`format=${format.toLowerCase()}`),
    ),
    page.waitForEvent("download"),
    page.getByRole("button", { name: format, exact: true }).click(),
  ])
  expect(response.status()).toBe(200)
  const body = await response.body()
  expect(body.byteLength).toBeGreaterThan(100)
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`))
  return { type: response.headers()["content-type"] ?? "", body }
}

test("employee downloads the timesheet PDF", async ({ as }) => {
  const page = await as("mia")
  await goto(page, "/reports")
  await expect(page.getByRole("tab", { name: "Timesheet", selected: true })).toBeVisible()
  const pdf = await download(page, "timesheet", "PDF")
  expect(pdf.type).toBe("application/pdf")
  expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-")
})

test("HR downloads balances as XLSX and CSV", async ({ as }) => {
  const page = await as("nina")
  await goto(page, "/reports")
  await page.getByRole("tab", { name: "Balances" }).click()
  await expect(page.getByRole("tab", { name: "Balances", selected: true })).toBeVisible()

  const xlsx = await download(page, "balances", "XLSX")
  expect(xlsx.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  expect(xlsx.body.subarray(0, 2).toString()).toBe("PK")

  const csv = await download(page, "balances", "CSV")
  expect(csv.type).toMatch(/^text\/csv/)
  expect(csv.body.toString()).toContain("Anna Meier")
})
