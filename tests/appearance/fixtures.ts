import type { Page } from "@playwright/test";

export const APPEARANCE_VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 1024, height: 900 },
  desktop: { width: 1480, height: 900 },
  ultrawide: { width: 1920, height: 1080 },
} as const;

export async function openAppearanceHarness(page: Page): Promise<void> {
  await page.goto("/");
}
