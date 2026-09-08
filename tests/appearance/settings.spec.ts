import { expect, test } from "@playwright/test";

test("applies every bounded Settings override without changing structure", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId("accent-select").selectOption("violet");
  await page.getByTestId("surface-tone-select").selectOption("tinted");
  await page.getByTestId("radius-select").selectOption("rounded");
  await page.getByTestId("typography-select").selectOption("system");
  await page.getByTestId("effects-select").selectOption("off");
  await page.getByTestId("density-select").selectOption("compact");
  await page.getByTestId("apply-button").click();

  await expect(page.getByTestId("preview-scope")).toHaveAttribute(
    "data-crate-density",
    "compact",
  );
  await expect(page.getByTestId("preview-scope")).toHaveAttribute(
    "data-crate-effects",
    "off",
  );
  await expect(page.getByTestId("preview-scope")).toHaveAttribute(
    "data-crate-skin",
    "default",
  );
  await expect(page.getByTestId("accent-button")).toHaveCSS(
    "background-color",
    "rgb(139, 92, 246)",
  );
  await expect(page.getByTestId("appearance-card")).toHaveCSS(
    "border-top-left-radius",
    "16px",
  );
});

test("Cancel discards a draft and Reset clears only overrides", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId("accent-select").selectOption("violet");
  await page.getByTestId("cancel-button").click();
  await expect(page.getByTestId("accent-select")).toHaveValue("theme");

  await page.getByTestId("accent-select").selectOption("violet");
  await page.getByTestId("preset-select").selectOption("crateRed");
  await page.getByTestId("reset-button").click();
  await expect(page.getByTestId("accent-select")).toHaveValue("theme");
  await expect(page.getByTestId("preset-select")).toHaveValue("crateRed");
});
