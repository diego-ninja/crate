import { expect, test } from "@playwright/test";

test("uses the shared logo geometry with themed paint and reduced motion", async ({
  page,
}) => {
  await page.goto("/");

  const logo = page.getByTestId("logo");
  await expect(logo).toHaveAttribute("viewBox", "0 0 1052 1120");
  await expect(logo).toHaveAttribute("data-crate-logo-effects", "on");
  await expect(logo).toHaveAttribute("data-crate-logo-motion", "system");
  await expect(logo.locator("stop").first()).toHaveAttribute(
    "stop-color",
    "var(--brand-logo-start)",
  );

  await page.getByTestId("motion-select").selectOption("reduced");
  await page.getByTestId("apply-button").click();
  await expect(logo).toHaveAttribute("data-crate-logo-motion", "reduced");
});
