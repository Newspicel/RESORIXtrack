import { expect, test as setup } from "@playwright/test"
import { EVERYONE, PEOPLE, signIn, statePath } from "./fixtures"

for (const who of EVERYONE) {
  setup(`sign in as ${who}`, async ({ page }) => {
    await signIn(page, PEOPLE[who].email)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
    await page.context().storageState({ path: statePath(who) })
  })
}
