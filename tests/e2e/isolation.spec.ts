import type { Page } from "@playwright/test"
import { EVERYONE, expect, goto, PEOPLE, rows, test, type Who } from "./fixtures"

/** The id of a demo person, read the way an administrator finds it. */
async function idOf(admin: Page, who: Who): Promise<string> {
  await goto(admin, "/admin/users")
  await admin.getByRole("searchbox", { name: "Search name or email" }).fill(PEOPLE[who].email)
  await rows(admin).filter({ hasText: PEOPLE[who].email }).click()
  await expect(admin).toHaveURL(/\/admin\/users\/\d+/)
  return /\/admin\/users\/(\d+)/.exec(admin.url())![1]
}

const othersThan = (...me: Who[]) => EVERYONE.filter((w) => !me.includes(w)).map((w) => PEOPLE[w].name)

async function expectNoNames(page: Page, names: string[]) {
  // textContent includes hidden markup and the dehydrated query data: nothing may leak there either
  const text = (await page.locator("body").textContent()) ?? ""
  for (const name of names) expect(text, `"${name}" must not be visible`).not.toContain(name)
}

for (const path of ["/team", "/team/approvals", "/team/signoff", "/team/projects", "/admin/users", "/admin/settings"]) {
  test(`employee: ${path} sends back to the dashboard`, async ({ as }) => {
    const page = await as("mia")
    await goto(page, path)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Mia")
    await expectNoNames(page, othersThan("mia"))
    await expect(page.getByRole("link", { name: "Team overview" })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Employees" })).toHaveCount(0)
  })
}

for (const section of ["team/member", "admin/users"]) {
  test(`employee: a colleague's /${section}/<id> sends back to the dashboard`, async ({ as }) => {
    const leaId = await idOf(await as("admin"), "lea")
    const page = await as("mia")
    await goto(page, `/${section}/${leaId}`)
    await expect(page).toHaveURL(/\/$/)
    await expectNoNames(page, othersThan("mia"))
  })
}

test("lead: a member of another team is not found", async ({ as }) => {
  const admin = await as("admin")
  const annaId = await idOf(admin, "anna")

  const lead = await as("jonas")
  await goto(lead, `/team/member/${annaId}`)
  await expect(lead.getByRole("heading", { level: 1 })).toHaveText("This page does not exist.")
  await expectNoNames(lead, [PEOPLE.anna.name])
  await goto(lead, `/reports?tab=timesheet&user=${annaId}`)
  await expectNoNames(lead, [PEOPLE.anna.name])
})
