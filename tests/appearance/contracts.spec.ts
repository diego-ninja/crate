import { expect, test } from "@playwright/test";

test.describe("appearance contracts", () => {
  test("boots the default dark appearance with real runtime tokens", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByTestId("theme-mode")).toHaveText("dark");
    await expect(page.getByTestId("theme-skin")).toHaveText("default");
    await expect(page.getByTestId("appearance-card")).toHaveCSS(
      "background-color",
      "rgba(18, 18, 26, 0.78)",
    );
    await expect(page.getByTestId("appearance-card")).toHaveCSS(
      "color",
      "rgb(241, 245, 249)",
    );
  });

  test("resolves light crateRed without changing the secondary scope", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByTestId("preset-select").selectOption("crateRed");
    await page.getByTestId("mode-select").selectOption("light");
    await page.getByTestId("material-select").selectOption("solid");
    await page.getByTestId("apply-button").click();

    await expect(page.getByTestId("theme-mode")).toHaveText("light");
    await expect(page.getByTestId("theme-skin")).toHaveText("crateRed");
    await expect(page.getByTestId("appearance-card")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expect(page.getByTestId("appearance-card")).toHaveCSS(
      "color",
      "rgb(29, 29, 31)",
    );
    await expect(
      page.getByTestId("secondary-scope").locator(".appearance-card"),
    ).toHaveCSS("background-color", "rgba(18, 18, 26, 0.78)");
  });

  test("updates system mode live and respects reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({
      colorScheme: "dark",
      reducedMotion: "no-preference",
    });
    await page.goto("/");

    await page.getByTestId("mode-select").selectOption("system");
    await page.getByTestId("motion-select").selectOption("reduced");
    await page.getByTestId("apply-button").click();
    await expect(page.getByTestId("theme-mode")).toHaveText("dark");
    await expect(page.getByTestId("preview-scope")).toHaveAttribute(
      "data-crate-motion",
      "reduced",
    );

    await page.emulateMedia({
      colorScheme: "light",
      reducedMotion: "no-preference",
    });
    await expect(page.getByTestId("theme-mode")).toHaveText("light");
  });

  test("supports solid and glass materials and keeps portal content scoped", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByTestId("material-select").selectOption("solid");
    await page.getByTestId("apply-button").click();
    await expect(page.getByTestId("preview-scope")).toHaveAttribute(
      "data-surface",
      "solid",
    );
    await expect(page.getByTestId("portal-content")).toHaveCSS(
      "color",
      "rgb(241, 245, 249)",
    );

    await page.getByTestId("material-select").selectOption("glass");
    await page.getByTestId("apply-button").click();
    await expect(page.getByTestId("preview-scope")).toHaveAttribute(
      "data-surface",
      "glass",
    );
  });
});
