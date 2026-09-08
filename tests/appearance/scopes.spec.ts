import { expect, test } from "@playwright/test";
import { openAppearanceHarness } from "./fixtures";

test("keeps portal and secondary scopes isolated when the primary scope changes", async ({
  page,
}) => {
  await openAppearanceHarness(page);

  const secondaryCard = page
    .getByTestId("secondary-scope")
    .locator(".appearance-card");
  const initialSecondaryBackground = await secondaryCard.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  await page.getByTestId("preset-select").selectOption("crateRed");
  await page.getByTestId("mode-select").selectOption("light");
  await page.getByTestId("apply-button").click();

  await expect(page.getByTestId("portal-content")).toHaveCSS(
    "color",
    "rgb(29, 29, 31)",
  );
  await expect(secondaryCard).toHaveCSS(
    "background-color",
    initialSecondaryBackground,
  );
});
