const { test, expect } = require("@playwright/test");

test("Keepr web shell loads a stable route", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");

  await expect(page).toHaveTitle(/Auth|Keepr/i);
  await expect(page.locator("body")).toContainText(/Keepr/i);
  expect(pageErrors).toEqual([]);
});
