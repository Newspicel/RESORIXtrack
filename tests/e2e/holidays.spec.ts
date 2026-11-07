import { expect, goto, test } from "./fixtures"

test("everyone sees the public holidays that apply to them, read-only", async ({ as }) => {
  const page = await as("mia")
  await goto(page, "/holidays")
  await expect(page.getByRole("heading", { level: 1, name: "Public holidays" })).toBeVisible()
  await expect(page.getByText(/^(Assigned to you|Your team's calendar|Company default)$/)).toBeVisible()
  await expect(page.getByText("New Year's Day").filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Manage calendars" })).toHaveCount(0)

  const admin = await as("admin")
  await goto(admin, "/holidays")
  await admin.getByRole("link", { name: "Manage calendars" }).click()
  await expect(admin).toHaveURL(/\/admin\/holidays/)
})
