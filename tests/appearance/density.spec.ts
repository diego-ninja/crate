import { expect, test } from "@playwright/test";

test("keeps comfortable list geometry as the baseline and compacts only content spacing", async ({
  page,
}) => {
  await page.goto("/");

  const list = page.getByTestId("density-list");
  await expect(list).toHaveAttribute("data-density", "comfortable");
  await expect(list).toHaveCSS("gap", "4px");
  await expect(list.locator(".density-row").first()).toHaveCSS(
    "padding-top",
    "10px",
  );
  await expect(list.locator(".density-action").first()).toHaveCSS(
    "min-height",
    "40px",
  );

  await page.getByTestId("density-select").selectOption("compact");
  await page.getByTestId("apply-button").click();

  await expect(list).toHaveAttribute("data-density", "compact");
  await expect(list).toHaveCSS("gap", "2px");
  await expect(list.locator(".density-row").first()).toHaveCSS(
    "padding-top",
    "6px",
  );
  await expect(list.locator(".density-action").first()).toHaveCSS(
    "min-height",
    "40px",
  );
});

test("keeps the virtualized anchor estimate aligned with the selected density", async ({
  page,
}) => {
  await page.goto("/");

  const anchor = page.getByTestId("density-anchor");
  await expect(anchor).toHaveAttribute("data-estimate", "72");

  await page.getByTestId("density-select").selectOption("compact");
  await page.getByTestId("apply-button").click();
  await expect(anchor).toHaveAttribute("data-estimate", "64");
});
