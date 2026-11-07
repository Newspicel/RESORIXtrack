import {
  addDays,
  expect,
  goto,
  monthYear,
  PEOPLE,
  pick,
  pickDate,
  rows,
  test,
  toast,
  type Who,
  weekday,
  zurichDay,
} from "./fixtures"

test("vacation: request with preview, lead approves, employee sees it approved", async ({ as }, info) => {
  const who = pick<Who>(info, "mia", "noah")
  // half a year ahead: clear of the demo absences (at most four months ahead)
  let start = addDays(zurichDay(), 180)
  while (weekday(start) !== 0) start = addDays(start, 1)
  const end = addDays(start, 1)
  const month = monthYear(start)

  const page = await as(who)
  await goto(page, "/absences")
  await page.getByRole("button", { name: "Request absence" }).click()
  const dialog = page.getByRole("dialog", { name: "Request absence" })
  await pickDate(dialog.getByLabel("First day"), start)
  await pickDate(dialog.getByLabel("Last day"), end)
  await dialog.getByLabel("Note").fill("E2E vacation")
  await expect(dialog).toContainText(/\d+ working days?/)
  await expect(dialog).toContainText(/vacation days left after/)
  await expect(dialog).toContainText("Needs approval")
  await dialog.getByRole("button", { name: "Send request" }).click()
  await expect(toast(page, "Request sent")).toBeVisible()
  await expect(dialog).toBeHidden()
  const mine = rows(page).filter({ hasText: month })
  await expect(mine).toContainText("Pending")

  const lead = await as("jonas")
  await goto(lead, "/team/approvals")
  const request = rows(lead).filter({ hasText: PEOPLE[who].name }).filter({ hasText: month })
  await expect(request).toHaveCount(1)
  await request.getByRole("button", { name: "Approve" }).click()
  await expect(toast(lead, "Approved")).toBeVisible()
  await expect(request).toHaveCount(0)

  await page.reload()
  await expect(rows(page).filter({ hasText: month })).toContainText("Approved")
})

test("sick today: the team calendar shows colleagues 'Absent', never the reason", async ({ as }, info) => {
  const who = pick<Who>(info, "anna", "lea")
  const page = await as(who)
  await goto(page, "/")
  await expect(page.getByRole("region", { name: "You're not clocked in" })).toBeVisible()
  await page.waitForLoadState("networkidle")
  const sick = page.getByRole("button", { name: "Report sick" })
  // only offered on a working day (and not twice)
  test.skip(!(await sick.isVisible()), "reporting sick is not possible today")
  await sick.click()
  const confirm = page.getByRole("alertdialog", { name: "Report sick for today?" })
  await confirm.getByRole("button", { name: "Report sick" }).click()
  await expect(page.getByRole("heading", { name: "Get well soon!" })).toBeVisible()

  const colleague = await as(pick(info, "marc", "mia"))
  await goto(colleague, "/calendar")
  const today = colleague.getByRole("region", {
    name: new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "Europe/Zurich",
    }).format(new Date()),
  })
  const entry = today.getByRole("listitem").filter({ hasText: PEOPLE[who].name })
  await expect(entry).toContainText("Absent")
  await expect(today).not.toContainText(/sick/i)
})
