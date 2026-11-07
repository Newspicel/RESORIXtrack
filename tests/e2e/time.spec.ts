import { expect, goto, isMobile, lastWeekday, pick, pickDate, test } from "./fixtures"

test("clock in, break, resume, clock out from the bar; dashboard follows", async ({ as }, info) => {
  // desktop: top bar pill; mobile: sticky clock bar above the tab bar (both are the group "Clock")
  const page = await as(pick(info, "sofia", "marc"))
  await goto(page, "/")
  const bar = page.getByRole("group", { name: "Clock" })
  const hero = page.getByRole("region", { name: /^You're/ })
  await expect(bar).toBeVisible()
  await expect(hero).toHaveAccessibleName("You're not clocked in")

  await bar.getByRole("button", { name: "Clock in", exact: true }).click()
  await expect(bar).toContainText("Working")
  await expect(hero).toHaveAccessibleName("You're clocked in")
  await expect(hero).toContainText(/since \d{2}:\d{2}/)

  await bar.getByRole("button", { name: "Start break" }).click()
  await expect(bar).toContainText("On break")
  await expect(hero).toHaveAccessibleName("You're on a break")

  await bar.getByRole("button", { name: "End break" }).click()
  await expect(bar).toContainText("Working")
  await expect(hero).toHaveAccessibleName("You're clocked in")

  await bar.getByRole("button", { name: "Clock out", exact: true }).click()
  await expect(bar).toContainText("Not clocked in")
  await expect(hero).toHaveAccessibleName("You're not clocked in")

  // the punches are on My time
  await goto(page, "/time")
  await expect(page.getByRole("button", { name: /^Work \d{2}:\d{2}/ }).last()).toBeVisible()
})

test("manual entry: add, edit, delete with undo, restore", async ({ as }, info) => {
  const page = await as(pick(info, "mia", "noah"))
  const day = lastWeekday(6) // a Sunday: no demo entries
  await goto(page, `/time?date=${day}`)

  await page.getByRole("button", { name: "Add entry", exact: true }).click()
  let dialog = page.getByRole("dialog", { name: "Add entry" })
  await pickDate(dialog.getByLabel("Date"), day)
  await dialog.getByLabel("Start").fill("10:00")
  await dialog.getByLabel("End").fill("11:30")
  await dialog.getByLabel("Note").fill("E2E manual entry")
  await dialog.getByLabel(/^Reason/).fill("Forgot to clock in")
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()

  const timeline = (from: string, to: string) => page.getByRole("button", { name: `Work ${from}–${to}` })
  await expect(timeline("10:00", "11:30")).toBeVisible()

  await timeline("10:00", "11:30").click()
  dialog = page.getByRole("dialog", { name: "Edit entry" })
  await expect(dialog.getByLabel("Note")).toHaveValue("E2E manual entry")
  await dialog.getByLabel("End").fill("12:15")
  await dialog.getByLabel(/^Reason/).fill("Stayed longer")
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()
  await expect(timeline("10:00", "12:15")).toBeVisible()

  const remove = async () => {
    await timeline("10:00", "12:15").click()
    const editor = page.getByRole("dialog", { name: "Edit entry" })
    await editor.getByLabel(/^Reason/).fill("Booked twice")
    await editor.getByRole("button", { name: "Delete" }).click()
    await expect(editor).toBeHidden()
  }
  // delete, then undo from the toast
  await remove()
  await expect(page.getByText("Entry deleted")).toBeVisible()
  await expect(timeline("10:00", "12:15")).toBeHidden()
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(timeline("10:00", "12:15")).toBeVisible()

  // delete again, then restore from the deleted entries
  await remove()
  await expect(timeline("10:00", "12:15")).toBeHidden()
  await page.getByRole("switch", { name: "Show deleted" }).click()
  if (isMobile(info)) {
    // phones show entries as a list; the row opens the entry
    await page
      .getByRole("listitem")
      .filter({ hasText: /10:00.12:15/ })
      .getByRole("button")
      .first()
      .click()
  } else {
    await page
      .getByRole("row", { name: /10:00.12:15/ })
      .getByRole("button", { name: "Restore" })
      .click()
  }
  // a past day: restoring asks for a reason
  const entry = page.getByRole("dialog", { name: "Entry" })
  await entry.getByLabel(/^Reason/).fill("Deleted by mistake")
  await entry.getByRole("button", { name: "Restore" }).click()
  await expect(page.getByText("Entry restored")).toBeVisible()
  await page.getByRole("switch", { name: "Show deleted" }).click()
  await expect(timeline("10:00", "12:15")).toBeVisible()
})
