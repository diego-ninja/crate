import { expect, test } from "@playwright/test";

test.describe("artist hero appearance contract", () => {
  test("uses the shared desktop frame for clear artwork and bounds-aware extend", async ({
    page,
  }) => {
    await page.goto("/");

    const hero = page.getByTestId("desktop-artist-hero-frame");
    await expect(hero).toHaveAttribute("data-artwork", "clear");
    await expect(hero).toHaveAttribute(
      "data-fit",
      "object-cover object-center",
    );
    await expect(
      page.getByTestId("desktop-hero-left-edge-scrim"),
    ).toBeVisible();
    await expect(page.getByTestId("desktop-hero-bottom-scrim")).toBeVisible();

    await page.getByTestId("hero-artwork-mode").selectOption("dark-extend");
    await expect(hero).toHaveAttribute("data-artwork", "dark-extend");
    await expect(hero).toHaveAttribute("data-fit", "object-fill");
    await expect(hero).toHaveAttribute("data-bounds", "0.12,0,0.88,0.82");
  });

  test("keeps mobile composition and themed overlay content inside the frame", async ({
    page,
  }) => {
    await page.goto("/");

    const hero = page.getByTestId("mobile-artist-hero-frame");
    await expect(hero).toHaveAttribute("data-artwork", "clear");
    await expect(hero).toHaveCSS("aspect-ratio", "4 / 5");
    await expect(page.getByTestId("mobile-hero-scrim")).toBeVisible();
    await expect(page.getByTestId("mobile-hero-presentation")).toBeVisible();
    await expect(
      page
        .getByTestId("mobile-hero-presentation")
        .getByTestId("hero-result-artist-name"),
    ).toHaveText("Quicksand");
  });
});
