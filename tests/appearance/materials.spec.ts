import { expect, test } from "@playwright/test";
import { openAppearanceHarness } from "./fixtures";

test("switches between solid and glass recipes without changing the active skin", async ({
  page,
}) => {
  await openAppearanceHarness(page);

  await page.getByTestId("material-select").selectOption("solid");
  await page.getByTestId("apply-button").click();
  await expect(page.getByTestId("preview-scope")).toHaveAttribute(
    "data-surface",
    "solid",
  );
  await expect(page.getByTestId("theme-skin")).toHaveText("default");

  await page.getByTestId("material-select").selectOption("glass");
  await page.getByTestId("apply-button").click();
  await expect(page.getByTestId("preview-scope")).toHaveAttribute(
    "data-surface",
    "glass",
  );
  await expect(page.getByTestId("theme-skin")).toHaveText("default");
});
