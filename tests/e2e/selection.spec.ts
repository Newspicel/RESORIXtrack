import { expect, test } from "./fixtures"

// Regression: row/cell objects are reused by TanStack Table; the checkboxes must still reflect selection changes.
test("table selection: row and select-all checkboxes update", async ({ as }, info) => {
  test.skip(info.project.name === "mobile", "selection checkboxes are a desktop table feature")
  const page = await as("nina")
  await page.goto("/team/approvals")
  const rows = page.locator("tbody tr")
  await expect(rows.first()).toBeVisible()
  const box = (i: number) => rows.nth(i).getByRole("checkbox")
  await box(0).click()
  await expect(box(0)).toBeChecked()
  await expect(rows.nth(0)).toHaveAttribute("data-state", "selected")
  await expect(box(1)).not.toBeChecked()
  const all = page.locator("thead").getByRole("checkbox")
  await all.click()
  await expect(all).toBeChecked()
  await expect(box(1)).toBeChecked()
  await all.click()
  await expect(box(0)).not.toBeChecked()
})
