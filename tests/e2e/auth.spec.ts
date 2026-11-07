import { expect, goto, PEOPLE, signIn, test } from "./fixtures"

test("sign in: wrong password, success, sign out", async ({ page }) => {
  await signIn(page, PEOPLE.mia.email, "wrong-password")
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect.")
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel("Password").fill("demo")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: /Mia/ })).toBeVisible()

  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()

  // the session is gone: app pages send you back to the sign-in page
  await page.goto("/time")
  await expect(page).toHaveURL(/\/login/)
})

test("forgot password page renders", async ({ page }) => {
  await goto(page, "/login")
  await page.getByRole("link", { name: "Forgot password?" }).click()
  await expect(page).toHaveURL(/\/forgot/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reset password")
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible()
})
