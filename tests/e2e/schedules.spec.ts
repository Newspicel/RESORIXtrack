import { addDays, expect, goto, isMobile, PEOPLE, pick, rows, test, toast, zurichDay } from "./fixtures"

/** Open a person's member page from the team overview and switch to the schedule tab. */
async function openSchedule(page: import("@playwright/test").Page, name: string) {
  await goto(page, "/team")
  await rows(page).filter({ hasText: name }).first().click()
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(name) })).toBeVisible()
  await page.getByRole("tab", { name: "Schedule" }).click()
  return page.getByRole("tabpanel", { name: "Schedule" })
}

test("HR without the admin role adds, edits and deletes a planned schedule version", async ({ as }, info) => {
  const hr = await as("nina")
  const person = pick(info, PEOPLE.tim.name, PEOPLE.lea.name)
  const panel = await openSchedule(hr, person)
  await panel.getByRole("button", { name: "New version" }).click()
  const sheet = hr.getByRole("dialog", { name: "New schedule" })

  // a start before today needs a reason
  await sheet.getByLabel("Valid from").click()
  const calendar = hr.locator("[data-slot=calendar]")
  const past = addDays(`${zurichDay().slice(0, 7)}-01`, -20)
  await calendar.getByRole("button", { name: /previous/i }).click()
  await calendar.getByRole("button", { name: /previous/i }).click()
  await calendar.locator(`[data-iso="${past}"]`).click()
  await sheet.getByRole("button", { name: "Save" }).click()
  await expect(sheet.getByLabel("Reason (required)")).toBeVisible()
  await expect(sheet.getByText("Required", { exact: true })).toBeVisible()
  await sheet.getByRole("button", { name: "Cancel" }).click()
  await expect(sheet).toBeHidden()

  // a planned version (default: first day of next month) with the quick fill scaled by the pensum
  await panel.getByRole("button", { name: "New version" }).click()
  await sheet.getByLabel("Pensum (%)").fill("80")
  await sheet.getByRole("button", { name: "Full-time Mon–Fri" }).click()
  await expect(sheet.getByLabel("Mon")).toHaveValue("6:43")
  await expect(sheet.getByLabel("Sat")).toHaveValue("0:00")
  await expect(sheet.getByLabel("Reason (required)")).toBeHidden()
  await sheet.getByRole("button", { name: "Save" }).click()
  await expect(sheet).toBeHidden()
  await expect(toast(hr, "Saved")).toBeVisible()
  const planned = rows(hr).filter({ hasText: "Planned" })
  await expect(planned).toHaveCount(1)
  await expect(planned).toContainText("80 %")

  // planned versions open for editing and can be deleted
  await planned.click()
  const edit = hr.getByRole("dialog", { name: "Edit version" })
  await edit.getByRole("button", { name: "Delete" }).click()
  await hr.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  await expect(edit).toBeHidden()
  await expect(rows(hr).filter({ hasText: "Planned" })).toHaveCount(0)
})

test("a lead edits schedules only while the setting allows it", async ({ as }, info) => {
  // the setting is company-wide: one project changes it, so the other cannot race it
  test.skip(isMobile(info), "changes a company setting")
  const admin = await as("admin")
  const setLeadEdit = async (on: boolean) => {
    await goto(admin, "/admin/settings?tab=time")
    const toggle = admin.getByRole("switch", { name: "Leads edit schedules" })
    if ((await toggle.isChecked()) !== on) {
      await toggle.click()
      await admin.getByRole("button", { name: "Save" }).click()
      await expect(toast(admin, "Saved")).toBeVisible()
    }
  }
  const lead = await as("luca")
  try {
    await setLeadEdit(true)
    let panel = await openSchedule(lead, PEOPLE.anna.name)
    await expect(panel.getByRole("button", { name: "New version" })).toBeVisible()

    await setLeadEdit(false)
    panel = await openSchedule(lead, PEOPLE.anna.name)
    await expect(panel.getByText("Read only")).toBeVisible()
    await expect(panel.getByRole("button", { name: "New version" })).toHaveCount(0)
  } finally {
    await setLeadEdit(true)
  }
})
